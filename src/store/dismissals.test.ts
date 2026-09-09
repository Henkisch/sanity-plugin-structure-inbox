import {describe, expect, it} from 'vitest'

import {
  DISMISSAL_TTL_DAYS,
  EMPTY_DISMISSALS,
  isDismissed,
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
