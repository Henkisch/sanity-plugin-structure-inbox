import {describe, expect, it} from 'vitest'

import {classifyRelease, type ReleaseFacts} from './releaseAttention'

const NOW = Date.parse('2026-09-16T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return {state: 'active', ...overrides}
}

describe('classifyRelease', () => {
  it('leaves a future scheduled release with documents alone', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW + 30 * DAY_MS).toISOString(), documentCount: 3}),
        NOW,
      ),
    ).toBeNull()
  })

  it('flags a past scheduled release that did not run as overdue', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW - 2 * DAY_MS).toISOString(), documentCount: 3}),
        NOW,
      ),
    ).toBe('overdue')
  })

  it('flags an empty release two days out as emptyAndImminent', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW + 2 * DAY_MS).toISOString(), documentCount: 0}),
        NOW,
      ),
    ).toBe('emptyAndImminent')
  })

  it('leaves an empty release thirty days out alone', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW + 30 * DAY_MS).toISOString(), documentCount: 0}),
        NOW,
      ),
    ).toBeNull()
  })

  it('never treats an unknown document count as empty', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW + 2 * DAY_MS).toISOString(), documentCount: undefined}),
        NOW,
      ),
    ).toBeNull()
  })

  it('flags an undated release created forty days ago as ageingUndated', () => {
    expect(
      classifyRelease(facts({createdAt: new Date(NOW - 40 * DAY_MS).toISOString()}), NOW),
    ).toBe('ageingUndated')
  })

  it('leaves an undated release created yesterday alone', () => {
    expect(
      classifyRelease(facts({createdAt: new Date(NOW - 1 * DAY_MS).toISOString()}), NOW),
    ).toBeNull()
  })

  it('prefers overdue when a release is both overdue and empty', () => {
    expect(
      classifyRelease(
        facts({scheduledAt: new Date(NOW - 2 * DAY_MS).toISOString(), documentCount: 0}),
        NOW,
      ),
    ).toBe('overdue')
  })

  it('never throws on an unparseable scheduledAt, and treats it as undated', () => {
    expect(classifyRelease(facts({scheduledAt: 'not-a-date', documentCount: 0}), NOW)).toBeNull()
  })
})
