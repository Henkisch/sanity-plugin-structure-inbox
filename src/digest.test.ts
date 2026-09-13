import {describe, expect, it} from 'vitest'

import {buildDigest} from './digest'
import {EMPTY_DISMISSALS, withDismissal} from './store/dismissals'
import {EMPTY_SNOOZES, withSnooze} from './store/snoozes'

const now = Date.parse('2026-06-01T12:00:00.000Z')

function item(id: string) {
  return {id, title: `Item ${id}`}
}

describe('buildDigest', () => {
  it('keeps an item dismissed by one editor in another editor\'s digest', () => {
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [
      {userId: 'a', dismissals: withDismissal(EMPTY_DISMISSALS, 'drafts', '1'), snoozes: EMPTY_SNOOZES},
      {userId: 'b', dismissals: EMPTY_DISMISSALS, snoozes: EMPTY_SNOOZES},
    ]

    const digests = buildDigest(sources, editors, now)

    expect(digests.find((d) => d.userId === 'a')?.open).toEqual([])
    expect(digests.find((d) => d.userId === 'b')?.open).toEqual([item('1')])
  })

  it('excludes a snoozed item from the editor it is snoozed for', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [
      {userId: 'a', dismissals: EMPTY_DISMISSALS, snoozes: withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)},
    ]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: []}])
  })

  it('combines two sources into one editor\'s open list', () => {
    const sources = [
      {name: 'drafts', items: [item('1')]},
      {name: 'releases', items: [item('2')]},
    ]
    const editors = [{userId: 'a', dismissals: EMPTY_DISMISSALS, snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: [item('1'), item('2')]}])
  })

  it('treats an editor with no dismissals or snoozes as seeing everything open', () => {
    const sources = [{name: 'drafts', items: [item('1'), item('2')]}]
    const editors = [{userId: 'a', dismissals: EMPTY_DISMISSALS, snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: [item('1'), item('2')]}])
  })

  it('returns an empty array for zero editors, and empty open lists for zero sources', () => {
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [{userId: 'a', dismissals: EMPTY_DISMISSALS, snoozes: EMPTY_SNOOZES}]

    expect(buildDigest(sources, [], now)).toEqual([])
    expect(buildDigest([], editors, now)).toEqual([{userId: 'a', open: []}])
  })
})
