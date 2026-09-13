import {describe, expect, it} from 'vitest'

import {
  DISMISSAL_TTL_DAYS,
  EMPTY_DISMISSALS,
  isDismissed,
  mergeDismissals,
  parseDismissals,
  pruneDismissals,
  withDismissal,
  withoutDismissal,
} from './dismissals'

const DAY = 24 * 60 * 60 * 1000

describe('parseDismissals', () => {
  it('reads back what it wrote', () => {
    const stored = withDismissal(EMPTY_DISMISSALS, 'tasks', 'task-1', '2026-01-01T00:00:00.000Z')

    expect(parseDismissals(stored)).toEqual(stored)
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a future version', {version: 99, dismissed: {tasks: {'task-1': 'x'}}}],
    ['a missing map', {version: 1}],
  ])('treats %s as nothing dismissed', (_label, value) => {
    // Anything we did not write is discarded rather than coerced: an editor who
    // downgrades should see their whole inbox, not a crash.
    expect(parseDismissals(value)).toEqual(EMPTY_DISMISSALS)
  })

  it('drops individual sources that are the wrong shape', () => {
    const parsed = parseDismissals({
      version: 1,
      dismissed: {good: {'item-1': '2026-01-01T00:00:00.000Z'}, bad: {'item-2': 42}},
    })

    expect(Object.keys(parsed.dismissed)).toEqual(['good'])
  })
})

describe('pruneDismissals', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')
  const iso = (offsetDays: number) => new Date(now - offsetDays * DAY).toISOString()

  it('keeps recent entries and drops expired ones', () => {
    const state = {
      version: 1 as const,
      dismissed: {
        drafts: {fresh: iso(1), stale: iso(DISMISSAL_TTL_DAYS + 1)},
      },
    }

    expect(pruneDismissals(state, now).dismissed.drafts).toEqual({fresh: iso(1)})
  })

  it('removes a source entirely once its last entry expires', () => {
    const state = {version: 1 as const, dismissed: {drafts: {old: iso(365)}}}

    expect(pruneDismissals(state, now).dismissed).toEqual({})
  })

  it('drops entries with an unparseable timestamp', () => {
    const state = {version: 1 as const, dismissed: {drafts: {broken: 'not a date'}}}

    expect(pruneDismissals(state, now).dismissed).toEqual({})
  })

  it('keeps an exempt source entries past the TTL', () => {
    const state = {
      version: 1 as const,
      dismissed: {todos: {old: iso(DISMISSAL_TTL_DAYS + 1)}},
    }

    expect(pruneDismissals(state, now, ['todos']).dismissed.todos).toEqual({
      old: iso(DISMISSAL_TTL_DAYS + 1),
    })
  })

  it('still prunes a non-exempt source in the same state', () => {
    const state = {
      version: 1 as const,
      dismissed: {
        todos: {old: iso(DISMISSAL_TTL_DAYS + 1)},
        drafts: {old: iso(DISMISSAL_TTL_DAYS + 1)},
      },
    }

    const result = pruneDismissals(state, now, ['todos'])

    expect(result.dismissed.todos).toEqual({old: iso(DISMISSAL_TTL_DAYS + 1)})
    expect(result.dismissed.drafts).toBeUndefined()
  })

  it('preserves existing behavior when the third argument is omitted', () => {
    const state = {
      version: 1 as const,
      dismissed: {todos: {old: iso(DISMISSAL_TTL_DAYS + 1)}},
    }

    expect(pruneDismissals(state, now).dismissed).toEqual({})
  })
})

describe('a dismissal expires when the item changes', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z')
  const ticked = new Date(now).toISOString()
  const state = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', ticked)
  const oneHourBefore = new Date(now - 60 * 60 * 1000).toISOString()
  const oneHourAfter = new Date(now + 60 * 60 * 1000).toISOString()
  const oneYearAfter = new Date(now + 365 * DAY).toISOString()

  it('stays done while the item is unchanged', () => {
    expect(isDismissed(state, 'drafts', 'doc-1', oneHourBefore)).toBe(true)
  })

  it('comes back when the item is touched afterwards', () => {
    // The tick said "I have seen this version", not "hide this document
    // forever" — editing it again is exactly what an inbox should resurface.
    expect(isDismissed(state, 'drafts', 'doc-1', oneHourAfter)).toBe(false)
  })

  it('stays done forever when the item has no timestamp', () => {
    expect(isDismissed(state, 'drafts', 'doc-1')).toBe(true)
  })

  it('stays done when the item timestamp is unreadable', () => {
    expect(isDismissed(state, 'drafts', 'doc-1', 'not a date')).toBe(true)
  })

  it('stays dismissed for an item whose due date is a year out, once ticked', () => {
    // The regression this guards: `upcomingReleases` and `openTasks` display a
    // future due/publish date, but that value must never reach `isDismissed`
    // as the change-detection argument — passed here, a future value is
    // always later than the tick and immediately resurrects the item
    // (demonstrated below). The fix (InboxSection reading `item.changedAt`,
    // and each source populating it from a real modification time such as
    // `_updatedAt`, never from a due date) means the pure function is only
    // ever called with the item's real change time, which for an untouched
    // release stays dismissed.
    const releaseState = withDismissal(EMPTY_DISMISSALS, 'releases', 'r1', ticked)
    const realModificationTime = oneHourBefore // e.g. the release's `_updatedAt`

    expect(isDismissed(releaseState, 'releases', 'r1', realModificationTime)).toBe(true)

    // The bug in one line: feeding the future due date straight into
    // isDismissed — which is exactly what the old `item.timestamp` call site
    // did — reopens the item the instant it is ticked.
    expect(isDismissed(releaseState, 'releases', 'r1', oneYearAfter)).toBe(false)
  })
})

describe('dismiss and restore', () => {
  it('round-trips a single item', () => {
    const dismissed = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1')

    expect(isDismissed(dismissed, 'drafts', 'doc-1')).toBe(true)
    expect(isDismissed(withoutDismissal(dismissed, 'drafts', 'doc-1'), 'drafts', 'doc-1')).toBe(
      false,
    )
  })

  it('keeps sources apart, so the same id in two sources is two decisions', () => {
    const state = withDismissal(EMPTY_DISMISSALS, 'drafts', 'shared-id')

    expect(isDismissed(state, 'releases', 'shared-id')).toBe(false)
  })

  it("leaves a source's other items alone when one is restored", () => {
    let state = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1')
    state = withDismissal(state, 'drafts', 'doc-2')

    const restored = withoutDismissal(state, 'drafts', 'doc-1')

    expect(isDismissed(restored, 'drafts', 'doc-2')).toBe(true)
  })
})

describe('mergeDismissals', () => {
  it('unions two disjoint sources', () => {
    const a = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-01T00:00:00.000Z')
    const b = withDismissal(EMPTY_DISMISSALS, 'releases', 'rel-1', '2026-01-02T00:00:00.000Z')

    expect(mergeDismissals(a, b)).toEqual({
      version: 1,
      dismissed: {
        drafts: {'doc-1': '2026-01-01T00:00:00.000Z'},
        releases: {'rel-1': '2026-01-02T00:00:00.000Z'},
      },
    })
  })

  it('keeps both items when the same source has different item ids', () => {
    const a = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-01T00:00:00.000Z')
    const b = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-2', '2026-01-02T00:00:00.000Z')

    expect(mergeDismissals(a, b)).toEqual({
      version: 1,
      dismissed: {
        drafts: {'doc-1': '2026-01-01T00:00:00.000Z', 'doc-2': '2026-01-02T00:00:00.000Z'},
      },
    })
  })

  it('keeps the later timestamp when the same source and item appear in both, whichever side it is on', () => {
    const earlier = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-01T00:00:00.000Z')
    const later = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-02T00:00:00.000Z')

    // Later timestamp on the second argument.
    expect(mergeDismissals(earlier, later).dismissed.drafts['doc-1']).toBe(
      '2026-01-02T00:00:00.000Z',
    )
    // Later timestamp on the first argument.
    expect(mergeDismissals(later, earlier).dismissed.drafts['doc-1']).toBe(
      '2026-01-02T00:00:00.000Z',
    )
  })

  it('an unparseable timestamp loses to a parseable one on either side', () => {
    const broken = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', 'not a date')
    const parseable = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-01T00:00:00.000Z')

    expect(mergeDismissals(broken, parseable).dismissed.drafts['doc-1']).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    expect(mergeDismissals(parseable, broken).dismissed.drafts['doc-1']).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })

  it('returns the other side unchanged when merging with EMPTY_DISMISSALS', () => {
    const state = withDismissal(EMPTY_DISMISSALS, 'drafts', 'doc-1', '2026-01-01T00:00:00.000Z')

    expect(mergeDismissals(EMPTY_DISMISSALS, state)).toEqual(state)
    expect(mergeDismissals(state, EMPTY_DISMISSALS)).toEqual(state)
  })
})
