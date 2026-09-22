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

  it('parses a stored value with no `removed` field — the shape every document written before tombstones existed has', () => {
    const stored = {
      version: 1,
      snoozed: {drafts: {'doc-1': {at: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z'}}},
    }

    const parsed = parseSnoozes(stored)

    expect(parsed).toEqual(stored)
    expect(parsed.removed).toBeUndefined()
  })

  it('drops individual removed sources that are the wrong shape, keeping snoozed intact', () => {
    const parsed = parseSnoozes({
      version: 1,
      snoozed: {good: {'item-1': {at: '2026-01-01T00:00:00.000Z', until: '2026-01-02T00:00:00.000Z'}}},
      removed: {good: {'item-2': 'not-an-entry'}},
    })

    expect(parsed.removed).toBeUndefined()
  })

  it('round-trips a tombstone', () => {
    const stored = withoutSnooze(
      withSnooze(EMPTY_SNOOZES, 'tasks', 'task-1', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      'tasks',
      'task-1',
      '2026-01-15T00:00:00.000Z',
    )

    expect(parseSnoozes(stored)).toEqual(stored)
    expect(stored.removed).toEqual({
      tasks: {'task-1': {at: '2026-01-15T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z'}},
    })
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

  it('prunes tombstones once their carried `until` has passed — the same rule as entries, not a second policy', () => {
    const state = withoutSnooze(
      withSnooze(EMPTY_SNOOZES, 'drafts', 'past', '2026-05-01T00:00:00.000Z'),
      'drafts',
      'past',
    )
    const stateWithFutureToo = withoutSnooze(
      withSnooze(state, 'drafts', 'future', '2026-07-01T00:00:00.000Z'),
      'drafts',
      'future',
    )

    expect(pruneSnoozes(stateWithFutureToo, now).removed).toEqual({
      drafts: {future: expect.objectContaining({until: '2026-07-01T00:00:00.000Z'})},
    })
  })

  it('drops the `removed` field entirely once every tombstone has expired', () => {
    const state = withoutSnooze(withSnooze(EMPTY_SNOOZES, 'drafts', 'old', '2026-01-01T00:00:00.000Z'), 'drafts', 'old')

    expect(pruneSnoozes(state, now).removed).toBeUndefined()
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

  describe('tombstones', () => {
    it('the regression: a key woken locally stays awake after merging a server value that still has it snoozed', () => {
      const server = withSnooze(
        EMPTY_SNOOZES,
        'drafts',
        'doc-1',
        '2026-06-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
      const local = withoutSnooze(server, 'drafts', 'doc-1', '2026-01-02T00:00:00.000Z')

      const merged = mergeSnoozes(server, local)

      expect(merged.snoozed.drafts?.['doc-1']).toBeUndefined()
    })

    it('the inverse still works: a key the local side has never seen is adopted from the server', () => {
      const server = withSnooze(
        EMPTY_SNOOZES,
        'drafts',
        'doc-1',
        '2026-06-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )

      const merged = mergeSnoozes(server, EMPTY_SNOOZES)

      expect(merged.snoozed.drafts?.['doc-1']).toEqual({
        at: '2026-01-01T00:00:00.000Z',
        until: '2026-06-01T00:00:00.000Z',
      })
    })

    it('a tombstone older than a server entry loses, because the entry was re-snoozed after the wake', () => {
      const wokenEarly = withoutSnooze(
        withSnooze(
          EMPTY_SNOOZES,
          'drafts',
          'doc-1',
          '2026-06-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        ),
        'drafts',
        'doc-1',
        '2026-01-02T00:00:00.000Z',
      )
      const reSnoozedLater = withSnooze(
        EMPTY_SNOOZES,
        'drafts',
        'doc-1',
        '2026-07-01T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
      )

      const merged = mergeSnoozes(wokenEarly, reSnoozedLater)

      expect(merged.snoozed.drafts?.['doc-1']).toEqual({
        at: '2026-01-03T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
      })
      expect(merged.removed?.drafts?.['doc-1']).toBeUndefined()
    })

    it('a tombstone newer than a server entry wins, keeping the item awake', () => {
      const snoozedEarly = withSnooze(
        EMPTY_SNOOZES,
        'drafts',
        'doc-1',
        '2026-06-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
      const wokenLater = withoutSnooze(snoozedEarly, 'drafts', 'doc-1', '2026-01-02T00:00:00.000Z')

      const merged = mergeSnoozes(snoozedEarly, wokenLater)

      expect(merged.snoozed.drafts?.['doc-1']).toBeUndefined()
      expect(merged.removed?.drafts?.['doc-1']).toEqual({
        at: '2026-01-02T00:00:00.000Z',
        until: '2026-06-01T00:00:00.000Z',
      })
    })

    it('omits `removed` entirely when nothing is tombstoned', () => {
      const a = withSnooze(EMPTY_SNOOZES, 'drafts', 'doc-1', '2026-06-01', '2026-01-01T00:00:00.000Z')
      const b = withSnooze(EMPTY_SNOOZES, 'releases', 'rel-1', '2026-06-02', '2026-01-02T00:00:00.000Z')

      expect(mergeSnoozes(a, b).removed).toBeUndefined()
    })
  })
})
