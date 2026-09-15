import {describe, expect, it} from 'vitest'

import {EMPTY_DISMISSALS, withDismissal} from '../store/dismissals'
import {mergeRows} from './mergeItems'
import {type SourceReport} from './SourceFeed'
import {type InboxItem} from './types'

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function report(open: InboxItem[], overrides: Partial<SourceReport> = {}): SourceReport {
  return {
    source: {name: 'x', title: 'X', useItems: () => ({items: []})},
    open,
    cleared: [],
    snoozed: [],
    ...overrides,
  }
}

describe('mergeRows', () => {
  it('sorts the most urgent tone first', () => {
    const reports = {
      drafts: report([item('a', {tone: 'default'}), item('b', {tone: 'critical'})]),
    }

    expect(mergeRows(reports, ['drafts'], 'open', EMPTY_DISMISSALS).map((row) => row.item.id)).toEqual([
      'b',
      'a',
    ])
  })

  it('breaks a tone tie by earliest timestamp first', () => {
    const reports = {
      drafts: report([
        item('a', {timestamp: '2026-01-03T00:00:00.000Z'}),
        item('b', {timestamp: '2026-01-01T00:00:00.000Z'}),
      ]),
    }

    expect(mergeRows(reports, ['drafts'], 'open', EMPTY_DISMISSALS).map((row) => row.item.id)).toEqual([
      'b',
      'a',
    ])
  })

  it('sorts across sources, not within them', () => {
    const reports = {
      drafts: report([item('draft-1', {tone: 'default'})]),
      tasks: report([item('task-1', {tone: 'critical'})]),
    }

    expect(
      mergeRows(reports, ['drafts', 'tasks'], 'open', EMPTY_DISMISSALS).map((row) => row.sourceName),
    ).toEqual(['tasks', 'drafts'])
  })

  it('keeps configured source order as the tiebreak when tone and timestamp both tie', () => {
    const reports = {
      drafts: report([item('draft-1')]),
      tasks: report([item('task-1')]),
    }

    expect(
      mergeRows(reports, ['tasks', 'drafts'], 'open', EMPTY_DISMISSALS).map((row) => row.key),
    ).toEqual(['tasks task-1', 'drafts draft-1'])
  })

  it('sorts an undated item after every dated one', () => {
    const reports = {
      drafts: report([item('undated'), item('dated', {timestamp: '2026-01-01T00:00:00.000Z'})]),
    }

    expect(mergeRows(reports, ['drafts'], 'open', EMPTY_DISMISSALS).map((row) => row.item.id)).toEqual([
      'dated',
      'undated',
    ])
  })

  it('reads the requested view, not always open', () => {
    const reports = {
      drafts: {...report([]), cleared: [item('cleared-1')], snoozed: [item('snoozed-1')]},
    }

    expect(
      mergeRows(reports, ['drafts'], 'cleared', EMPTY_DISMISSALS).map((row) => row.item.id),
    ).toEqual(['cleared-1'])
    expect(
      mergeRows(reports, ['drafts'], 'snoozed', EMPTY_DISMISSALS).map((row) => row.item.id),
    ).toEqual(['snoozed-1'])
  })

  it('skips a source with no report yet, rather than throwing', () => {
    expect(mergeRows({}, ['drafts'], 'open', EMPTY_DISMISSALS)).toEqual([])
  })

  it('tags a real, source-confirmed cleared item with clearedBy: source and its own changedAt', () => {
    const reports = {
      tasks: report([], {cleared: [item('t1', {changedAt: '2026-01-02T00:00:00.000Z'})]}),
    }

    const [row] = mergeRows(reports, ['tasks'], 'cleared', EMPTY_DISMISSALS)
    expect(row.clearedBy).toBe('source')
    expect(row.clearedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('moves a non-stale dismissal on an open item into Cleared, tagged clearedBy: editor', () => {
    const reports = {
      drafts: report([item('d1')]),
    }
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'drafts', 'd1', '2026-01-05T00:00:00.000Z')

    expect(mergeRows(reports, ['drafts'], 'open', dismissals)).toEqual([])
    const [row] = mergeRows(reports, ['drafts'], 'cleared', dismissals)
    expect(row.item.id).toBe('d1')
    expect(row.clearedBy).toBe('editor')
    expect(row.clearedAt).toBe('2026-01-05T00:00:00.000Z')
  })

  it("returns a manually-cleared item to Open once it changes again — a dismissal only says 'seen as of then'", () => {
    const reports = {
      drafts: report([item('d1', {changedAt: '2026-01-10T00:00:00.000Z'})]),
    }
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'drafts', 'd1', '2026-01-05T00:00:00.000Z')

    expect(mergeRows(reports, ['drafts'], 'cleared', dismissals)).toEqual([])
    expect(mergeRows(reports, ['drafts'], 'open', dismissals).map((row) => row.item.id)).toEqual(['d1'])
  })

  it('never treats a dismissal as a manual clear for a source that opted out of acknowledgable', () => {
    const reports = {
      todos: report([item('td1')], {acknowledgable: false}),
    }
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'todos', 'td1')

    expect(mergeRows(reports, ['todos'], 'cleared', dismissals)).toEqual([])
    expect(mergeRows(reports, ['todos'], 'open', dismissals).map((row) => row.item.id)).toEqual(['td1'])
  })
})
