import {describe, expect, it} from 'vitest'

import {
  EMPTY_ASSESSMENTS,
  parseAssessments,
  pruneAssessments,
  readAssessment,
  withAssessment,
} from './assessments'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const CHANGED_AT = '2026-06-01T00:00:00.000Z'

describe('assessments', () => {
  it('round-trips: write then read with the same changedAt returns the assessment', () => {
    const state = withAssessment(
      EMPTY_ASSESSMENTS,
      'drafts',
      'item-1',
      {message: 'Looks ready.', tone: 'positive'},
      CHANGED_AT,
      new Date(NOW).toISOString(),
    )

    expect(readAssessment(state, 'drafts', 'item-1', CHANGED_AT)).toEqual({
      message: 'Looks ready.',
      tone: 'positive',
    })
  })

  it('returns null when the item has since changed (a different changedAt)', () => {
    const state = withAssessment(
      EMPTY_ASSESSMENTS,
      'drafts',
      'item-1',
      {message: 'Looks ready.'},
      CHANGED_AT,
    )

    expect(readAssessment(state, 'drafts', 'item-1', '2026-06-10T00:00:00.000Z')).toBeNull()
  })

  it('returns null when itemChangedAt is undefined, even with a cached entry', () => {
    const state = withAssessment(
      EMPTY_ASSESSMENTS,
      'drafts',
      'item-1',
      {message: 'Looks ready.'},
      CHANGED_AT,
    )

    expect(readAssessment(state, 'drafts', 'item-1', undefined)).toBeNull()
  })

  it('withAssessment is a no-op (same reference back) when itemChangedAt is undefined', () => {
    const result = withAssessment(EMPTY_ASSESSMENTS, 'drafts', 'item-1', {message: 'x'}, undefined)

    expect(result).toBe(EMPTY_ASSESSMENTS)
  })

  it('does not let two sources with the same itemId collide', () => {
    let state = withAssessment(EMPTY_ASSESSMENTS, 'drafts', 'item-1', {message: 'From drafts.'}, CHANGED_AT)
    state = withAssessment(state, 'tasks', 'item-1', {message: 'From tasks.'}, CHANGED_AT)

    expect(readAssessment(state, 'drafts', 'item-1', CHANGED_AT)?.message).toBe('From drafts.')
    expect(readAssessment(state, 'tasks', 'item-1', CHANGED_AT)?.message).toBe('From tasks.')
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a future version', {version: 99, assessed: {drafts: {}}}],
    [
      'an entry missing changedAt',
      {version: 1, assessed: {drafts: {'item-1': {message: 'x', assessedAt: new Date(NOW).toISOString()}}}},
    ],
  ])('parseAssessments treats %s as nothing cached', (_label, value) => {
    expect(parseAssessments(value)).toEqual(EMPTY_ASSESSMENTS)
  })

  it('prunes an entry past the TTL and keeps one inside it', () => {
    const old = withAssessment(
      EMPTY_ASSESSMENTS,
      'drafts',
      'old-item',
      {message: 'old'},
      CHANGED_AT,
      new Date(NOW - 100 * DAY).toISOString(),
    )
    const state = withAssessment(old, 'drafts', 'new-item', {message: 'new'}, CHANGED_AT, new Date(NOW).toISOString())

    const pruned = pruneAssessments(state, NOW)

    expect(readAssessment(pruned, 'drafts', 'old-item', CHANGED_AT)).toBeNull()
    expect(readAssessment(pruned, 'drafts', 'new-item', CHANGED_AT)?.message).toBe('new')
  })

  it('round-trips a stored entry with no tone as {message} only', () => {
    const state = withAssessment(EMPTY_ASSESSMENTS, 'drafts', 'item-1', {message: 'Plain.'}, CHANGED_AT)

    expect(readAssessment(state, 'drafts', 'item-1', CHANGED_AT)).toEqual({message: 'Plain.'})
  })
})
