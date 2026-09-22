import {cleanup, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {type SnoozeState} from '../store/snoozes'
import {renderWithTheme} from '../test/renderWithTheme'
import {
  countOverdue,
  countUnassigned,
  groupByAssigneeLoad,
  InboxStats,
  nextWake,
  oldestOpenAgeDays,
  truncateLabel,
} from './InboxStats'
import {type MergedRow} from './mergeItems'
import {type InboxItem} from './types'

afterEach(cleanup)

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function row(
  sourceName: string,
  itemProps: Partial<InboxItem> & {id: string},
  rowProps: Partial<Pick<MergedRow, 'clearedAt' | 'clearedBy'>> = {},
): MergedRow {
  return {
    key: `${sourceName} ${itemProps.id}`,
    sourceName,
    item: item(itemProps.id, itemProps),
    ...rowProps,
  }
}

/** `STATS_MIN_ROWS` or more plain rows, none carrying anything that would itself trigger a stat line, so a test can cross the threshold without changing what it's asserting on. */
function manyRows(count: number): MergedRow[] {
  return Array.from({length: count}, (_, i) => row('tasks', {id: `filler-${i}`}))
}

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY_SNOOZED: SnoozeState['snoozed'] = {}

describe('countUnassigned', () => {
  it('counts only rows with nobody on them', () => {
    const rows = [
      row('tasks', {id: '1'}),
      row('tasks', {id: '2', assignee: {id: 'ada', label: 'Ada'}}),
      row('tasks', {id: '3'}),
    ]
    expect(countUnassigned(rows)).toBe(2)
  })
})

describe('groupByAssigneeLoad', () => {
  it('groups and counts by assignee, busiest first', () => {
    const rows = [
      row('tasks', {id: '1', assignee: {id: 'ada', label: 'Ada'}}),
      row('tasks', {id: '2', assignee: {id: 'bea', label: 'Bea'}}),
      row('tasks', {id: '3', assignee: {id: 'ada', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([
      {id: 'ada', label: 'Ada', imageUrl: undefined, count: 2},
      {id: 'bea', label: 'Bea', imageUrl: undefined, count: 1},
    ])
  })

  it('does not merge two different people who happen to share a display name', () => {
    const rows = [
      row('tasks', {id: '1', assignee: {id: 'ada-1', label: 'Ada'}}),
      row('tasks', {id: '2', assignee: {id: 'ada-2', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([
      {id: 'ada-1', label: 'Ada', imageUrl: undefined, count: 1},
      {id: 'ada-2', label: 'Ada', imageUrl: undefined, count: 1},
    ])
  })

  it('excludes unassigned rows entirely', () => {
    const rows = [
      row('tasks', {id: '1'}),
      row('tasks', {id: '2', assignee: {id: 'ada', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([{id: 'ada', label: 'Ada', imageUrl: undefined, count: 1}])
  })
})

describe('oldestOpenAgeDays', () => {
  it('returns the oldest row, not the last one in the list', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW - 2 * DAY_MS).toISOString()}),
      row('tasks', {id: '2', timestamp: new Date(NOW - 10 * DAY_MS).toISOString()}),
      row('tasks', {id: '3', timestamp: new Date(NOW - 5 * DAY_MS).toISOString()}),
    ]
    expect(oldestOpenAgeDays(rows, NOW)).toBe(10)
  })

  it('returns null for an empty list', () => {
    expect(oldestOpenAgeDays([], NOW)).toBeNull()
  })

  it('excludes a row with no parseable timestamp rather than treating it as any particular age', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW - 3 * DAY_MS).toISOString()}),
      row('tasks', {id: 'no-date'}),
    ]
    expect(oldestOpenAgeDays(rows, NOW)).toBe(3)
  })

  it('excludes a future timestamp — a due date is not a wait, and never a negative age', () => {
    const futureOnly = [row('tasks', {id: '1', timestamp: new Date(NOW + 7 * DAY_MS).toISOString()})]
    expect(oldestOpenAgeDays(futureOnly, NOW)).toBeNull()

    const mixed = [
      row('tasks', {id: '1', timestamp: new Date(NOW + 7 * DAY_MS).toISOString()}),
      row('tasks', {id: '2', timestamp: new Date(NOW - 3 * DAY_MS).toISOString()}),
    ]
    expect(oldestOpenAgeDays(mixed, NOW)).toBe(3)
  })

  it('never yields a negative value once floored, across a mix of past, future, and unparseable timestamps', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW + 1 * DAY_MS).toISOString()}),
      row('tasks', {id: '2', timestamp: new Date(NOW - 0.5 * DAY_MS).toISOString()}),
      row('tasks', {id: 'no-date'}),
    ]
    const result = oldestOpenAgeDays(rows, NOW)
    expect(result).not.toBeNull()
    expect(Math.floor(result as number)).toBeGreaterThanOrEqual(0)
  })

  it('skips a timestamp that fails to parse, same as a missing one', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW - 3 * DAY_MS).toISOString()}),
      row('tasks', {id: 'bad-date', timestamp: 'not-a-real-date'}),
    ]
    expect(oldestOpenAgeDays(rows, NOW)).toBe(3)
  })
})

describe('nextWake', () => {
  it('returns the soonest wake time, not the first row in the list', () => {
    const rows = [row('tasks', {id: '1'}), row('tasks', {id: '2'})]
    const snoozed: SnoozeState['snoozed'] = {
      tasks: {
        '1': {at: NOW.toString(), until: new Date(NOW + 5 * DAY_MS).toISOString()},
        '2': {at: NOW.toString(), until: new Date(NOW + 1 * DAY_MS).toISOString()},
      },
    }
    expect(nextWake(rows, snoozed)).toBe(new Date(NOW + 1 * DAY_MS).toISOString())
  })

  it('returns null when nothing is snoozed', () => {
    expect(nextWake([], EMPTY_SNOOZED)).toBeNull()
  })

  it('compares wake times as instants, not as strings', () => {
    const rows = [row('tasks', {id: '1'}), row('tasks', {id: '2'})]
    // '05:00:00-06:00' is 11:00Z — chronologically later than '10:00:00Z' —
    // but sorts *earlier* as a plain string, which is the bug this guards.
    const snoozed: SnoozeState['snoozed'] = {
      tasks: {
        '1': {at: NOW.toString(), until: '2026-01-01T10:00:00Z'},
        '2': {at: NOW.toString(), until: '2026-01-01T05:00:00-06:00'},
      },
    }
    expect(nextWake(rows, snoozed)).toBe('2026-01-01T10:00:00Z')
  })

  it('skips an until that fails to parse rather than letting it win the comparison', () => {
    const rows = [row('tasks', {id: '1'}), row('tasks', {id: '2'})]
    const soonest = new Date(NOW + 2 * DAY_MS).toISOString()
    const snoozed: SnoozeState['snoozed'] = {
      tasks: {
        '1': {at: NOW.toString(), until: 'not-a-real-date'},
        '2': {at: NOW.toString(), until: soonest},
      },
    }
    expect(nextWake(rows, snoozed)).toBe(soonest)
  })
})

describe('countOverdue', () => {
  it('counts only rows explicitly marked overdue', () => {
    const rows = [
      row('tasks', {id: '1', overdue: true}),
      row('tasks', {id: '2', overdue: false}),
      row('tasks', {id: '3', overdue: true}),
    ]
    expect(countOverdue(rows)).toBe(2)
  })

  it('does not count a merely-critical-toned row that is not overdue', () => {
    const rows = [
      row('tasks', {id: '1', tone: 'critical', overdue: true}),
      row('assetIssues', {id: '2', tone: 'critical'}), // no `overdue` — e.g. a broken link
    ]
    expect(countOverdue(rows)).toBe(1)
  })
})

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: {count?: number}) =>
        typeof params?.count === 'number' ? `${key} ${params.count}` : key,
    }),
  }
})

describe('truncateLabel', () => {
  it('returns a short label unchanged', () => {
    expect(truncateLabel('Ada')).toBe('Ada')
  })

  it('crops a label past the character cap and appends an ellipsis', () => {
    const long = 'A'.repeat(50)
    const result = truncateLabel(long)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBe(40)
  })

  it('leaves a label exactly at the cap unchanged', () => {
    const exact = 'A'.repeat(40)
    expect(truncateLabel(exact)).toBe(exact)
  })
})

describe('InboxStats', () => {
  it('renders nothing at all below the row threshold', () => {
    const {container} = renderWithTheme(
      <InboxStats assignableRows={[]} now={NOW} openRows={[]} snoozed={EMPTY_SNOOZED} snoozedRows={[]} />,
    )
    expect(container.textContent).toBe('')
  })

  it('renders above the row threshold', () => {
    const rows = manyRows(12)
    renderWithTheme(
      <InboxStats
        assignableRows={rows}
        now={NOW}
        openRows={rows}
        snoozed={EMPTY_SNOOZED}
        snoozedRows={[]}
      />,
    )
    expect(screen.getByText('stats.title')).toBeTruthy()
  })

  it('renders below the row threshold when something wakes within 24 hours', () => {
    const rows = manyRows(2)
    const snoozed: SnoozeState['snoozed'] = {
      tasks: {'woke-1': {at: NOW.toString(), until: new Date(NOW + 6 * 60 * 60 * 1000).toISOString()}},
    }
    renderWithTheme(
      <InboxStats
        assignableRows={rows}
        now={NOW}
        openRows={rows}
        snoozed={snoozed}
        snoozedRows={[row('tasks', {id: 'woke-1'})]}
      />,
    )
    expect(screen.getByText('stats.title')).toBeTruthy()
    expect(screen.getByText('stats.nextWake')).toBeTruthy()
  })

  it('renders the assignee label once above the row threshold', () => {
    const rows = [
      ...manyRows(11),
      row('tasks', {id: '1', timestamp: new Date(NOW).toISOString(), assignee: {id: 'ada', label: 'Ada'}}),
    ]

    renderWithTheme(
      <InboxStats assignableRows={rows} now={NOW} openRows={rows} snoozed={EMPTY_SNOOZED} snoozedRows={[]} />,
    )

    expect(screen.getByText('stats.title')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
  })

  it('truncates a long assignee name instead of rendering it in full', () => {
    const longName = 'A Very Long Display Name That Would Otherwise Overflow The Card'
    const rows = [
      ...manyRows(11),
      row('tasks', {id: '1', timestamp: new Date(NOW).toISOString(), assignee: {id: 'long', label: longName}}),
    ]

    renderWithTheme(
      <InboxStats assignableRows={rows} now={NOW} openRows={rows} snoozed={EMPTY_SNOOZED} snoozedRows={[]} />,
    )

    expect(screen.queryByText(longName)).toBeNull()
    expect(screen.getByText(truncateLabel(longName))).toBeTruthy()
  })

  it('shows an unassigned row in the per-assignee section, not a separate stat of its own', () => {
    const rows = manyRows(12)

    renderWithTheme(
      <InboxStats assignableRows={rows} now={NOW} openRows={rows} snoozed={EMPTY_SNOOZED} snoozedRows={[]} />,
    )

    expect(screen.getByText('stats.load.title')).toBeTruthy()
    expect(screen.getByText('assignee.unassigned')).toBeTruthy()
  })
})
