import {cleanup, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {type Dismissals} from '../store/useDismissals'
import {renderWithTheme} from '../test/renderWithTheme'
import {
  bucketByAge,
  countClearedToday,
  countUnassigned,
  groupByAssigneeLoad,
  InboxStats,
} from './InboxStats'
import {type MergedRow} from './mergeItems'
import {type InboxItem} from './types'

afterEach(cleanup)

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function row(sourceName: string, itemProps: Partial<InboxItem> & {id: string}): MergedRow {
  return {key: `${sourceName} ${itemProps.id}`, sourceName, item: item(itemProps.id, itemProps)}
}

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('bucketByAge', () => {
  it('buckets a same-day item as 0-2', () => {
    const rows = [row('drafts', {id: '1', timestamp: new Date(NOW).toISOString()})]
    expect(bucketByAge(rows, NOW)).toEqual({'0-2': 1, '3-7': 0, '8+': 0})
  })

  it('buckets a 5-day-old item as 3-7', () => {
    const rows = [row('drafts', {id: '1', timestamp: new Date(NOW - 5 * DAY).toISOString()})]
    expect(bucketByAge(rows, NOW)).toEqual({'0-2': 0, '3-7': 1, '8+': 0})
  })

  it('buckets a 10-day-old item as 8+', () => {
    const rows = [row('drafts', {id: '1', timestamp: new Date(NOW - 10 * DAY).toISOString()})]
    expect(bucketByAge(rows, NOW)).toEqual({'0-2': 0, '3-7': 0, '8+': 1})
  })

  it('treats an item with no timestamp as the oldest bucket, not dropped', () => {
    const rows = [row('todos', {id: '1'})]
    expect(bucketByAge(rows, NOW)).toEqual({'0-2': 0, '3-7': 0, '8+': 1})
  })
})

describe('countUnassigned', () => {
  it('counts only rows with nobody on them', () => {
    const rows = [
      row('tasks', {id: '1'}),
      row('tasks', {id: '2', assignee: {label: 'Ada'}}),
      row('tasks', {id: '3'}),
    ]
    expect(countUnassigned(rows)).toBe(2)
  })
})

describe('groupByAssigneeLoad', () => {
  it('groups and counts by assignee, busiest first', () => {
    const rows = [
      row('tasks', {id: '1', assignee: {label: 'Ada'}}),
      row('tasks', {id: '2', assignee: {label: 'Bea'}}),
      row('tasks', {id: '3', assignee: {label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([
      {label: 'Ada', imageUrl: undefined, count: 2},
      {label: 'Bea', imageUrl: undefined, count: 1},
    ])
  })

  it('excludes unassigned rows entirely', () => {
    const rows = [row('tasks', {id: '1'}), row('tasks', {id: '2', assignee: {label: 'Ada'}})]
    expect(groupByAssigneeLoad(rows)).toEqual([{label: 'Ada', imageUrl: undefined, count: 1}])
  })
})

describe('countClearedToday', () => {
  it('counts only entries dismissed on the same local day as now', () => {
    const dismissed = {
      drafts: {
        '1': new Date(NOW).toISOString(),
        '2': new Date(NOW - 2 * DAY).toISOString(),
      },
      tasks: {'3': new Date(NOW).toISOString()},
    }
    expect(countClearedToday(dismissed, NOW)).toBe(2)
  })

  it('returns 0 for an unparseable timestamp rather than throwing', () => {
    expect(countClearedToday({drafts: {'1': 'not-a-date'}}, NOW)).toBe(0)
  })
})

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {...actual, useTranslation: () => ({t: (key: string) => key})}
})

function fakeDismissals(): Dismissals {
  return {state: EMPTY_DISMISSALS, dismiss: vi.fn(), restore: vi.fn()}
}

describe('InboxStats', () => {
  it('renders the age breakdown, unassigned count and cleared-today count', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW).toISOString()}),
      row('tasks', {id: '2', assignee: {label: 'Ada'}}),
    ]

    renderWithTheme(
      <InboxStats assignableRows={rows} dismissals={fakeDismissals()} openRows={rows} />,
    )

    expect(screen.getByText('stats.title')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
  })

  it('omits the per-assignee section entirely when nobody has anything assigned', () => {
    const rows = [row('tasks', {id: '1'})]

    renderWithTheme(
      <InboxStats assignableRows={rows} dismissals={fakeDismissals()} openRows={rows} />,
    )

    expect(screen.queryByText('stats.load.title')).toBeNull()
  })
})
