export type ReleaseAttention = 'overdue' | 'emptyAndImminent' | 'ageingUndated'

export interface ReleaseFacts {
  state: string
  /** Whichever of `publishAt`/`metadata.intendedPublishAt` is populated — see `upcomingReleases.ts`'s own `scheduled` expression. */
  scheduledAt?: string
  /** When the release itself was created. */
  createdAt?: string
  /** How many documents it holds. `undefined` when not known. */
  documentCount?: number
}

/** An empty release within this many days of its scheduled time is worth a nudge; three weeks out is not. */
const IMMINENT_DAYS = 3

/** An undated release still being filled after three weeks has stopped being "in progress". */
const AGEING_DAYS = 21

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether a release is off track, and how badly.
 *
 * Returns `null` for the common case — a release running to plan is context,
 * not an obligation, and belongs in the aside column `upcomingReleases`
 * already owns. This function exists to find the exceptions.
 *
 * The three conditions deliberately carry different weight. An overdue
 * release has already missed its moment; an imminent empty one is still
 * fixable; an undated one accumulating for weeks is a slow leak. Colouring
 * all three the same would teach editors to stop reading the colour, which
 * is exactly what `InboxItem.tone`'s own doc comment warns against.
 */
export function classifyRelease(facts: ReleaseFacts, now: number): ReleaseAttention | null {
  const scheduledTime = facts.scheduledAt ? Date.parse(facts.scheduledAt) : NaN
  const hasScheduledTime = Number.isFinite(scheduledTime)
  const isRealized = facts.state === 'published' || facts.state === 'archived'

  // The more severe condition wins when a release qualifies for more than
  // one — an empty release that is also overdue is overdue, not merely
  // still-fixable-if-you-hurry.
  if (hasScheduledTime && !isRealized && scheduledTime < now) return 'overdue'

  // An unknown document count must never be treated as empty, or every
  // release alarms the moment the count query fails.
  if (
    hasScheduledTime &&
    !isRealized &&
    facts.documentCount === 0 &&
    scheduledTime - now <= IMMINENT_DAYS * DAY_MS
  ) {
    return 'emptyAndImminent'
  }

  if (!hasScheduledTime) {
    const createdTime = facts.createdAt ? Date.parse(facts.createdAt) : NaN
    if (Number.isFinite(createdTime) && now - createdTime > AGEING_DAYS * DAY_MS) {
      return 'ageingUndated'
    }
  }

  return null
}

/** Same tone this plugin already colours everything else by — see `InboxItem.tone`. */
export function toneForAttention(attention: ReleaseAttention): 'critical' | 'caution' | 'default' {
  if (attention === 'overdue') return 'critical'
  if (attention === 'emptyAndImminent') return 'caution'
  return 'default'
}
