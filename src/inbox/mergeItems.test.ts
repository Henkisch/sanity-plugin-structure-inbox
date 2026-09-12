import {describe, expect, it} from 'vitest'

import {mergeRows} from './mergeItems'
import {type SourceReport} from './SourceFeed'
import {type InboxItem} from './types'

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function report(open: InboxItem[]): SourceReport {
  return {
    source: {name: 'x', title: 'X', useItems: () => ({items: []})},
    open,
    done: [],
    snoozed: [],
  }
}

describe('mergeRows', () => {
  it('sorts the most urgent tone first', () => {
    const reports = {
      drafts: report([item('a', {tone: 'default'}), item('b', {tone: 'critical'})]),
    }

    expect(mergeRows(reports, ['drafts'], 'open').map((row) => row.item.id)).toEqual(['b', 'a'])
  })

  it('breaks a tone tie by earliest timestamp first', () => {
    const reports = {
      drafts: report([
        item('a', {timestamp: '2026-01-03T00:00:00.000Z'}),
        item('b', {timestamp: '2026-01-01T00:00:00.000Z'}),
      ]),
    }

    expect(mergeRows(reports, ['drafts'], 'open').map((row) => row.item.id)).toEqual(['b', 'a'])
  })

  it('sorts across sources, not within them', () => {
    const reports = {
      drafts: report([item('draft-1', {tone: 'default'})]),
      tasks: report([item('task-1', {tone: 'critical'})]),
    }

    expect(mergeRows(reports, ['drafts', 'tasks'], 'open').map((row) => row.sourceName)).toEqual([
      'tasks',
      'drafts',
    ])
  })

  it('keeps configured source order as the tiebreak when tone and timestamp both tie', () => {
    const reports = {
      drafts: report([item('draft-1')]),
      tasks: report([item('task-1')]),
    }

    expect(mergeRows(reports, ['tasks', 'drafts'], 'open').map((row) => row.key)).toEqual([
      'tasks task-1',
      'drafts draft-1',
    ])
  })

  it('sorts an undated item after every dated one', () => {
    const reports = {
      drafts: report([item('undated'), item('dated', {timestamp: '2026-01-01T00:00:00.000Z'})]),
    }

    expect(mergeRows(reports, ['drafts'], 'open').map((row) => row.item.id)).toEqual([
      'dated',
      'undated',
    ])
  })

  it('reads the requested view, not always open', () => {
    const reports = {
      drafts: {...report([]), done: [item('done-1')], snoozed: [item('snoozed-1')]},
    }

    expect(mergeRows(reports, ['drafts'], 'done').map((row) => row.item.id)).toEqual(['done-1'])
    expect(mergeRows(reports, ['drafts'], 'snoozed').map((row) => row.item.id)).toEqual([
      'snoozed-1',
    ])
  })

  it('skips a source with no report yet, rather than throwing', () => {
    expect(mergeRows({}, ['drafts'], 'open')).toEqual([])
  })
})
