import {describe, expect, it} from 'vitest'

import {EMPTY_SNOOZES, withSnooze} from '../store/snoozes'
import {splitItems} from './splitItems'
import {type InboxItem} from './types'

const now = Date.parse('2026-06-01T12:00:00.000Z')

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

describe('splitItems', () => {
  it('puts an untouched item in open', () => {
    const result = splitItems([item('1')], 'drafts', EMPTY_SNOOZES, now)
    expect(result).toEqual({open: [item('1')], cleared: [], snoozed: []})
  })

  it('puts a source-confirmed cleared item in cleared', () => {
    const result = splitItems([item('1', {cleared: true})], 'drafts', EMPTY_SNOOZES, now)
    expect(result).toEqual({open: [], cleared: [item('1', {cleared: true})], snoozed: []})
  })

  it('puts a snoozed item in snoozed', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const snoozes = withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)
    const result = splitItems([item('1')], 'drafts', snoozes, now)
    expect(result).toEqual({open: [], cleared: [], snoozed: [item('1')]})
  })

  it('cleared wins when an item is both cleared and snoozed', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const snoozes = withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)
    const result = splitItems([item('1', {cleared: true})], 'drafts', snoozes, now)
    expect(result).toEqual({open: [], cleared: [item('1', {cleared: true})], snoozed: []})
  })

  it('keeps sources apart, so the same id in two sources is two decisions', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const snoozes = withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)
    const result = splitItems([item('1')], 'releases', snoozes, now)
    expect(result.open).toEqual([item('1')])
  })
})
