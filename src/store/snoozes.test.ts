import {describe, expect, it} from 'vitest'

import {
  EMPTY_SNOOZES,
  isSnoozed,
  mergeSnoozes,
  parseSnoozes,
  pruneSnoozes,
  withoutSnooze,
  withSnooze,
} from './snoozes'

describe('parseSnoozes', () => {
  it('reads back what it wrote', () => {
    const stored = withSnooze(
      EMPTY_SNOOZES,
      'tasks',
      'task-1',
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    expect(parseSnoozes(stored)).toEqual(stored)
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a future version', {version: 99, snoozed: {tasks: {'task-1': {at: 'x', until: 'y'}}}}],
    ['a missing map', {version: 1}],
  ])('treats %s as nothing snoozed', (_label, value) => {
    expect(parseSnoozes(value)).toEqual(EMPTY_SNOOZES)
  })

  it('drops individual sources that are the wrong shape', () => {
    const parsed = parseSnoozes({
      version: 1,
      snoozed: {
        good: {'item-1': {at: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z'}},
        bad: {'item-2': 'not-an-entry'},
      },
    })

    expect(Object.keys(parsed.snoozed)).toEqual(['good'])
  })
})

describe('pruneSnoozes', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')

  it('drops entries whose wake time has passed and keeps the rest', () => {
    const state = withSnooze(
      withSnooze(EMPTY_SNOOZES, 'drafts', 'past', '2026-05-01T00:00:00.000Z'),
      'drafts',
      'future',
      '2026-07-01T00:00:00.000Z',
    )

    expect(pruneSnoozes(state, now).snoozed).toEqual({
      drafts: {future: expect.objectContaining({until: '2026-07-01T00:00:00.000Z'})},
    })
  })

  it('removes a source entirely once its last entry expires', () => {
    const state = withSnooze(EMPTY_SNOOZES, 'drafts', 'old', '2026-01-01T00:00:00.000Z')

    expect(pruneSnoozes(state, now).snoozed).toEqual({})
  })

  it('drops entries with an unparseable wake time', () => {
    const state = withSnooze(EMPTY_SNOOZES, 'drafts', 'broken', 'not a date')

    expect(pruneSnoozes(state, now).snoozed).toEqual({})
  })
})

describe('isSnoozed', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z')
  const at = new Date(now).toISOString()
  const until = new Date(now + 60 * 60 * 1000).toISOString()
  const state = withSnooze(EMPTY_SNOOZES, 'drafts', 'doc-1', until, at)

  it('is asleep before the wake time', () => {
    expect(isSnoozed(state, 'drafts', 'doc-1', now)).toBe(true)
  })

  it('wakes once the wake time passes', () => {
    expect(isSnoozed(state, 'drafts', 'doc-1', now + 2 * 60 * 60 * 1000)).toBe(false)
  })

  it('wakes early when the item changes after it was snoozed', () => {
    const changedAfter = new Date(now + 30 * 60 * 1000).toISOString()
    expect(isSnoozed(state, 'drafts', 'doc-1', now, changedAfter)).toBe(false)
  })

  it('stays asleep for a change from before it was snoozed', () => {
    const changedBefore = new Date(now - 30 * 60 * 1000).toISOString()
    expect(isSnoozed(state, 'drafts', 'doc-1', now, changedBefore)).toBe(true)
  })

  it('is never snoozed for an item with no entry', () => {
    expect(isSnoozed(EMPTY_SNOOZES, 'drafts', 'doc-1', now)).toBe(false)
  })

  it('fails open when the wake time is corrupted', () => {
    const corrupted = withSnooze(EMPTY_SNOOZES, 'drafts', 'doc-1', 'not a date', at)
    expect(isSnoozed(corrupted, 'drafts', 'doc-1', now)).toBe(false)
  })
})

describe('snooze and wake', () => {
  it('round-trips a single item', () => {
    const snoozed = withSnooze(EMPTY_SNOOZES, 'drafts', 'doc-1', '2026-06-02T00:00:00.000Z')

    expect(isSnoozed(snoozed, 'drafts', 'doc-1', Date.parse('2026-06-01T00:00:00.000Z'))).toBe(true)
    expect(
      isSnoozed(
        withoutSnooze(snoozed, 'drafts', 'doc-1'),
        'drafts',
        'doc-1',
        Date.parse('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('keeps sources apart, so the same id in two sources is two decisions', () => {
    const state = withSnooze(EMPTY_SNOOZES, 'drafts', 'shared-id', '2026-06-02T00:00:00.000Z')

    expect(isSnoozed(state, 'releases', 'shared-id', Date.parse('2026-06-01T00:00:00.000Z'))).toBe(
      false,
    )
  })
})

describe('mergeSnoozes', () => {
  it('unions two disjoint sources', () => {
    const a = withSnooze(EMPTY_SNOOZES, 'drafts', 'doc-1', '2026-01-05', '2026-01-01T00:00:00.000Z')
    const b = withSnooze(
      EMPTY_SNOOZES,
      'releases',
      'rel-1',
      '2026-01-06',
      '2026-01-02T00:00:00.000Z',
    )

    expect(mergeSnoozes(a, b).snoozed).toEqual({
      drafts: {'doc-1': {at: '2026-01-01T00:00:00.000Z', until: '2026-01-05'}},
      releases: {'rel-1': {at: '2026-01-02T00:00:00.000Z', until: '2026-01-06'}},
    })
  })

  it('keeps the more recently-set entry when the same source and item appear in both', () => {
    const earlier = withSnooze(
      EMPTY_SNOOZES,
      'drafts',
      'doc-1',
      '2026-01-05',
      '2026-01-01T00:00:00.000Z',
    )
    const later = withSnooze(
      EMPTY_SNOOZES,
      'drafts',
      'doc-1',
      '2026-01-10',
      '2026-01-02T00:00:00.000Z',
    )

    expect(mergeSnoozes(earlier, later).snoozed.drafts['doc-1'].until).toBe('2026-01-10')
    expect(mergeSnoozes(later, earlier).snoozed.drafts['doc-1'].until).toBe('2026-01-10')
  })

  it('returns the other side unchanged when merging with EMPTY_SNOOZES', () => {
    const state = withSnooze(
      EMPTY_SNOOZES,
      'drafts',
      'doc-1',
      '2026-01-05',
      '2026-01-01T00:00:00.000Z',
    )

    expect(mergeSnoozes(EMPTY_SNOOZES, state)).toEqual(state)
    expect(mergeSnoozes(state, EMPTY_SNOOZES)).toEqual(state)
  })
})
