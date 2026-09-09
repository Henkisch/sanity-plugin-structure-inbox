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
