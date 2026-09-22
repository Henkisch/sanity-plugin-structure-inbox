import {type InboxAssessment, type InboxItem} from '../inbox/types'
import {DISMISSAL_TTL_DAYS} from './dismissals'

type Tone = NonNullable<InboxItem['tone']>

const TONES: readonly Tone[] = ['default', 'primary', 'positive', 'caution', 'critical']

function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value)
}

/**
 * One cached AI assessment of an item — the `assess` result `useAssessments`
 * stores, keyed by source and item id, and invalidated by `changedAt`.
 *
 * @public
 */
export interface CachedAssessment {
  message: string
  tone?: InboxItem['tone']
  /** The item's own `changedAt` at the moment this was cached — the whole invalidation check. */
  changedAt: string
  /** When the model actually answered. Only used for the TTL prune, never for invalidation. */
  assessedAt: string
}

/**
 * The shape stored under the assessments key.
 *
 * Versioned and read defensively, same as {@link DismissalState}.
 *
 * @public
 */
export interface AssessmentState {
  version: 1
  /** `{[sourceName]: {[itemId]: CachedAssessment}}` */
  assessed: Record<string, Record<string, CachedAssessment>>
}

export const ASSESSMENT_VERSION = 1

export const EMPTY_ASSESSMENTS: AssessmentState = {version: ASSESSMENT_VERSION, assessed: {}}

function isCachedAssessment(value: unknown): value is CachedAssessment {
  if (typeof value !== 'object' || value === null) return false
  if (!('message' in value) || typeof value.message !== 'string') return false
  if (!('changedAt' in value) || typeof value.changedAt !== 'string') return false
  if (!('assessedAt' in value) || typeof value.assessedAt !== 'string') return false
  if ('tone' in value && value.tone !== undefined && !isTone(value.tone)) return false
  return true
}

function isRecordOfCachedAssessments(value: unknown): value is Record<string, CachedAssessment> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(isCachedAssessment)
}

/**
 * Parses a stored value, discarding anything that is not what we wrote.
 *
 * @public
 */
export function parseAssessments(value: unknown): AssessmentState {
  if (typeof value !== 'object' || value === null) return EMPTY_ASSESSMENTS
  if (!('version' in value) || value.version !== ASSESSMENT_VERSION) return EMPTY_ASSESSMENTS
  if (!('assessed' in value) || typeof value.assessed !== 'object' || value.assessed === null) {
    return EMPTY_ASSESSMENTS
  }

  const assessed: AssessmentState['assessed'] = {}
  for (const [source, items] of Object.entries(value.assessed)) {
    if (isRecordOfCachedAssessments(items)) assessed[source] = items
  }

  return {version: ASSESSMENT_VERSION, assessed}
}

/**
 * Reads a cached assessment, or nothing.
 *
 * `itemChangedAt` is the whole correctness claim this cache makes: a cached
 * entry is only ever returned when it was written against the exact
 * `changedAt` the item carries right now. Without `itemChangedAt` at all
 * (a source that cannot observe its own items changing), nothing is ever
 * cached or read — a confidently-wrong "looks ready to publish" on a since-
 * edited draft is the one outcome this cache must never produce, and the
 * only way to guarantee that is to require an exact match rather than a
 * time-based guess.
 */
export function readAssessment(
  state: AssessmentState,
  source: string,
  itemId: string,
  itemChangedAt: string | undefined,
): InboxAssessment | null {
  if (!itemChangedAt) return null

  const cached = state.assessed[source]?.[itemId]
  if (!cached || cached.changedAt !== itemChangedAt) return null

  return cached.tone ? {message: cached.message, tone: cached.tone} : {message: cached.message}
}

/**
 * Caches an assessment, keyed by the item's own `changedAt`.
 *
 * A no-op (same reference back) when `itemChangedAt` is undefined — see
 * `readAssessment`'s own doc comment for why this cache never guesses at
 * freshness.
 */
export function withAssessment(
  state: AssessmentState,
  source: string,
  itemId: string,
  assessment: InboxAssessment,
  itemChangedAt: string | undefined,
  now = new Date().toISOString(),
): AssessmentState {
  if (!itemChangedAt) return state

  const cached: CachedAssessment = {
    message: assessment.message,
    tone: assessment.tone,
    changedAt: itemChangedAt,
    assessedAt: now,
  }

  return {
    version: ASSESSMENT_VERSION,
    assessed: {...state.assessed, [source]: {...state.assessed[source], [itemId]: cached}},
  }
}

/**
 * Drops entries whose `assessedAt` is older than {@link DISMISSAL_TTL_DAYS}
 * — deliberately the same constant `dismissals.ts` uses, not a second TTL to
 * keep in sync: an item this cache still holds an entry for after that long
 * is one nobody has looked at since, the same reasoning that already governs
 * how long a dismissal is remembered.
 */
export function pruneAssessments(state: AssessmentState, now = Date.now()): AssessmentState {
  const cutoff = now - DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  const assessed: AssessmentState['assessed'] = {}

  for (const [source, items] of Object.entries(state.assessed)) {
    const kept = Object.entries(items).filter(([, cached]) => {
      const time = Date.parse(cached.assessedAt)
      return Number.isFinite(time) && time >= cutoff
    })
    if (kept.length > 0) assessed[source] = Object.fromEntries(kept)
  }

  return {version: ASSESSMENT_VERSION, assessed}
}
