import {describe, expect, it} from 'vitest'

import {parseSnoozeSuggestion} from './snoozeSuggestion'

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('parseSnoozeSuggestion', () => {
  it('accepts a valid future date', () => {
    const future = new Date(NOW + 10 * DAY).toISOString()
    expect(parseSnoozeSuggestion({until: future, reason: 'Event on the 25th.'}, NOW)).toEqual({
      until: future,
      reason: 'Event on the 25th.',
    })
  })

  it('rejects a past date', () => {
    const past = new Date(NOW - DAY).toISOString()
    expect(parseSnoozeSuggestion({until: past}, NOW)).toBeNull()
  })

  it('rejects exactly-now', () => {
    expect(parseSnoozeSuggestion({until: new Date(NOW).toISOString()}, NOW)).toBeNull()
  })

  it('rejects 400 days out', () => {
    expect(parseSnoozeSuggestion({until: new Date(NOW + 400 * DAY).toISOString()}, NOW)).toBeNull()
  })

  it('accepts 364 days out', () => {
    const result = parseSnoozeSuggestion({until: new Date(NOW + 364 * DAY).toISOString()}, NOW)
    expect(result).not.toBeNull()
  })

  it('rejects an unparseable date string', () => {
    expect(parseSnoozeSuggestion({until: '2026-13-45'}, NOW)).toBeNull()
  })

  it('rejects a number in place of a date string', () => {
    expect(parseSnoozeSuggestion({until: 12345}, NOW)).toBeNull()
  })

  it('rejects a value missing until entirely', () => {
    expect(parseSnoozeSuggestion({reason: 'x'}, NOW)).toBeNull()
  })

  it('omits reason entirely when the model did not give one', () => {
    const future = new Date(NOW + 5 * DAY).toISOString()
    expect(parseSnoozeSuggestion({until: future}, NOW)).toEqual({until: future})
  })

  it('drops a whitespace-only reason while keeping the date', () => {
    const future = new Date(NOW + 5 * DAY).toISOString()
    expect(parseSnoozeSuggestion({until: future, reason: '   '}, NOW)).toEqual({until: future})
  })

  it('normalises the returned until to ISO regardless of input format', () => {
    const result = parseSnoozeSuggestion({until: '2026-07-01'}, NOW)
    expect(result?.until).toBe(new Date('2026-07-01').toISOString())
  })
})
