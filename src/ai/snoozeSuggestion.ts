/** A year out is the outer edge of "I will want to see this again". */
const MAX_SNOOZE_DAYS = 365

export interface SnoozeSuggestion {
  /** Normalised ISO instant — never the raw value the model answered with. */
  until: string
  reason?: string
}

/**
 * Validates a model's proposed snooze instant.
 *
 * Out-of-range answers are dropped rather than clamped. A model that
 * answers with last year's date, or with 2031, has misread the document —
 * clamping that to "one year from now" invents an intention nobody had, and
 * presents it to the editor as a suggestion worth taking. Returning `null`
 * costs one absent extra.
 */
export function parseSnoozeSuggestion(value: unknown, now: number): SnoozeSuggestion | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('until' in value) || typeof value.until !== 'string') return null

  const time = Date.parse(value.until)
  if (!Number.isFinite(time)) return null
  if (time <= now) return null
  if (time > now + MAX_SNOOZE_DAYS * 24 * 60 * 60 * 1000) return null

  const reason =
    'reason' in value && typeof value.reason === 'string' && value.reason.trim()
      ? value.reason.trim()
      : undefined

  const until = new Date(time).toISOString()

  return reason ? {until, reason} : {until}
}
