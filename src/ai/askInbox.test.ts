import {describe, expect, it} from 'vitest'

import {type MergedRow} from '../inbox/mergeItems'
import {type InboxItem} from '../inbox/types'
import {describeRows, selectionFromResponse} from './askInbox'

function row(key: string, sourceName: string, itemProps: Partial<InboxItem> & {id: string}): MergedRow {
  return {key, sourceName, item: {title: `Item ${itemProps.id}`, ...itemProps}}
}

describe('describeRows', () => {
  it('maps title/subtitle/source/key straight through', () => {
    const rows = [row('drafts d1', 'drafts', {id: 'd1', title: 'Draft one', subtitle: 'Post'})]

    expect(describeRows(rows)).toEqual([
      {key: 'drafts d1', source: 'drafts', title: 'Draft one', subtitle: 'Post', type: undefined, waitingSince: undefined, assignee: undefined},
    ])
  })

  it('pulls type out of intent.params.type, and omits it when there is no intent', () => {
    const withIntent = row('drafts d1', 'drafts', {
      id: 'd1',
      intent: {type: 'edit', params: {id: 'd1', type: 'post'}},
    })
    const withoutIntent = row('todos t1', 'todos', {id: 't1'})

    expect(describeRows([withIntent])[0].type).toBe('post')
    expect(describeRows([withoutIntent])[0].type).toBeUndefined()
  })
})

describe('selectionFromResponse', () => {
  const rows = [
    row('drafts d1', 'drafts', {id: 'd1'}),
    row('drafts d2', 'drafts', {id: 'd2'}),
    row('tasks t1', 'tasks', {id: 't1'}),
  ]

  it('returns only keys present in rows', () => {
    const result = selectionFromResponse({keys: ['drafts d1', 'tasks t1'], reason: 'Both about X.'}, rows)
    expect(result).toEqual({keys: ['drafts d1', 'tasks t1'], reason: 'Both about X.'})
  })

  it('drops an invented key while keeping the valid ones', () => {
    const result = selectionFromResponse({keys: ['drafts d1', 'nonexistent-key'], reason: 'x'}, rows)
    expect(result?.keys).toEqual(['drafts d1'])
  })

  it('collapses duplicate keys to one', () => {
    const result = selectionFromResponse({keys: ['drafts d1', 'drafts d1'], reason: 'x'}, rows)
    expect(result?.keys).toEqual(['drafts d1'])
  })

  it('returns a result (with an empty reason) when keys exist but reason does not', () => {
    const result = selectionFromResponse({keys: ['drafts d1']}, rows)
    expect(result).toEqual({keys: ['drafts d1'], reason: ''})
  })

  it('returns {keys: [], reason} for an explicitly empty selection, not null', () => {
    const result = selectionFromResponse({keys: [], reason: 'Nothing matches.'}, rows)
    expect(result).toEqual({keys: [], reason: 'Nothing matches.'})
  })

  it.each([
    ['a non-object answer', 'just a string'],
    ['a missing keys field', {reason: 'x'}],
    ['keys that is not an array', {keys: 'drafts d1'}],
  ])('returns null for %s', (_label, value) => {
    expect(selectionFromResponse(value, rows)).toBeNull()
  })

  it('drops a key that is a number rather than a string, without throwing', () => {
    const result = selectionFromResponse({keys: [42, 'drafts d1'], reason: 'x'}, rows)
    expect(result?.keys).toEqual(['drafts d1'])
  })
})
