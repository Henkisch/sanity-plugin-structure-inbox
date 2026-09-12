import {describe, expect, it} from 'vitest'

import {EMPTY_DISMISSALS, withDismissal} from '../store/dismissals'
import {EMPTY_SNOOZES, withSnooze} from '../store/snoozes'
import {splitItems} from './splitItems'

const now = Date.parse('2026-06-01T12:00:00.000Z')

function item(id: string) {
  return {id, title: `Item ${id}`}
}

describe('splitItems', () => {
  it('puts an untouched item in open', () => {
    const result = splitItems([item('1')], 'drafts', EMPTY_DISMISSALS, EMPTY_SNOOZES, now)
    expect(result).toEqual({open: [item('1')], done: [], snoozed: []})
  })

  it('puts a dismissed item in done', () => {
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'drafts', '1')
    const result = splitItems([item('1')], 'drafts', dismissals, EMPTY_SNOOZES, now)
    expect(result).toEqual({open: [], done: [item('1')], snoozed: []})
  })

  it('puts a snoozed item in snoozed', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const snoozes = withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)
    const result = splitItems([item('1')], 'drafts', EMPTY_DISMISSALS, snoozes, now)
    expect(result).toEqual({open: [], done: [], snoozed: [item('1')]})
  })

  it('done wins when an item is both dismissed and snoozed', () => {
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'drafts', '1')
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const snoozes = withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)
    const result = splitItems([item('1')], 'drafts', dismissals, snoozes, now)
    expect(result).toEqual({open: [], done: [item('1')], snoozed: []})
  })

  it('keeps sources apart, so the same id in two sources is two decisions', () => {
    const dismissals = withDismissal(EMPTY_DISMISSALS, 'drafts', '1')
    const result = splitItems([item('1')], 'releases', dismissals, EMPTY_SNOOZES, now)
    expect(result.open).toEqual([item('1')])
  })
})
