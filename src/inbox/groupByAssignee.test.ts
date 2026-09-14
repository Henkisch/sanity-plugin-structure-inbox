import {describe, expect, it} from 'vitest'

import {groupByAssignee} from './groupByAssignee'
import {type InboxItem} from './types'

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

describe('groupByAssignee', () => {
  it('groups items with an assignee under that assignee label', () => {
    const items = [
      item('a', {assignee: {id: 'u1', label: 'Ada Lovelace'}}),
      item('b', {assignee: {id: 'u1', label: 'Ada Lovelace'}}),
    ]

    const groups = groupByAssignee(items, [])

    expect(groups).toEqual([
      {assignee: 'Ada Lovelace', imageUrl: undefined, items: [items[0], items[1]]},
    ])
  })

  it('puts items with no assignee under Unassigned', () => {
    const groups = groupByAssignee([item('a')], [])

    expect(groups).toEqual([{assignee: 'Unassigned', imageUrl: undefined, items: [item('a')]}])
  })

  it('always sorts Unassigned last, regardless of alphabetical order', () => {
    const items = [
      item('a', {assignee: {id: 'u2', label: 'Zoe'}}),
      item('b'),
      item('c', {assignee: {id: 'u1', label: 'Ada'}}),
    ]

    expect(groupByAssignee(items, []).map((g) => g.assignee)).toEqual(['Ada', 'Zoe', 'Unassigned'])
  })

  it('seeds an empty group for a known assignee with no matching items', () => {
    const groups = groupByAssignee([], [{label: 'Ada Lovelace', imageUrl: 'ada.png'}])

    expect(groups).toEqual([{assignee: 'Ada Lovelace', imageUrl: 'ada.png', items: []}])
  })

  it('gives an item its own group even when its assignee is not in knownAssignees', () => {
    const items = [item('a', {assignee: {id: 'u9', label: 'Grace Hopper'}})]

    const groups = groupByAssignee(items, [{label: 'Ada Lovelace'}])

    expect(groups.map((g) => g.assignee)).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(groups.find((g) => g.assignee === 'Grace Hopper')?.items).toEqual(items)
  })
})
