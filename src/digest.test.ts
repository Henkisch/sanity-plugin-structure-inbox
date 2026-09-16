import {describe, expect, it} from 'vitest'

import {buildDigest} from './digest'
import {EMPTY_SNOOZES, withSnooze} from './store/snoozes'

const now = Date.parse('2026-06-01T12:00:00.000Z')

function item(id: string, extra: Partial<{cleared: boolean}> = {}) {
  return {id, title: `Item ${id}`, ...extra}
}

describe('buildDigest', () => {
  it("an item another editor merely acknowledged still shows as open — only a real cleared flag excludes it", () => {
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [{userId: 'a', snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: [item('1')]}])
  })

  it('excludes an item the source itself confirms is cleared', () => {
    const sources = [{name: 'drafts', items: [item('1', {cleared: true})]}]
    const editors = [{userId: 'a', snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: []}])
  })

  it('excludes a snoozed item from the editor it is snoozed for', () => {
    const until = new Date(now + 60 * 60 * 1000).toISOString()
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [{userId: 'a', snoozes: withSnooze(EMPTY_SNOOZES, 'drafts', '1', until)}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: []}])
  })

  it("combines two sources into one editor's open list", () => {
    const sources = [
      {name: 'drafts', items: [item('1')]},
      {name: 'releases', items: [item('2')]},
    ]
    const editors = [{userId: 'a', snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: [item('1'), item('2')]}])
  })

  it('treats an editor with no snoozes as seeing everything open', () => {
    const sources = [{name: 'drafts', items: [item('1'), item('2')]}]
    const editors = [{userId: 'a', snoozes: EMPTY_SNOOZES}]

    const digests = buildDigest(sources, editors, now)

    expect(digests).toEqual([{userId: 'a', open: [item('1'), item('2')]}])
  })

  it('returns an empty array for zero editors, and empty open lists for zero sources', () => {
    const sources = [{name: 'drafts', items: [item('1')]}]
    const editors = [{userId: 'a', snoozes: EMPTY_SNOOZES}]

    expect(buildDigest(sources, [], now)).toEqual([])
    expect(buildDigest([], editors, now)).toEqual([{userId: 'a', open: []}])
  })
})
