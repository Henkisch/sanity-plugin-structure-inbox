/** When a snooze was set, and when it wakes up on its own. */
export interface SnoozeEntry {
  /** Compared against the item's `changedAt`, the same way a dismissal is. */
  at: string
  /** Wakes the item even without a change. */
  until: string
}

/**
 * The shape stored under the snoozes key.
 *
 * Versioned and read defensively, same as {@link DismissalState}: a value
 * written by a future version of this plugin is treated as absent rather than
 * coerced.
 *
 * @public
 */
export interface SnoozeState {
  version: 1
  /** `{[sourceName]: {[itemId]: SnoozeEntry}}` */
  snoozed: Record<string, Record<string, SnoozeEntry>>
  /**
   * Keys woken early ("Wake now"), with when and what the wake replaced —
   * `at` is the moment of the wake (compared against a conflicting entry's
   * own `at`, the same way two `snoozed` entries are compared), and `until`
   * is copied from the entry that was woken. Storing the same
   * {@link SnoozeEntry} shape means pruning needs no second policy: an
   * expired tombstone is dropped by the exact same `until > now` rule
   * {@link pruneSnoozes} already applies to `snoozed` — once the original
   * snooze would have woken on its own anyway, there is nothing left for the
   * tombstone to protect against.
   *
   * Without this, `mergeSnoozes` is a pure union: a load that resolves after
   * a local "Wake now" puts the snooze straight back.
   *
   * Optional, and omitted entirely when empty, so a document written before
   * this field existed still parses (see `parseSnoozes`).
   */
  removed?: Record<string, Record<string, SnoozeEntry>>
}

export const SNOOZE_VERSION = 1

export const EMPTY_SNOOZES: SnoozeState = {version: SNOOZE_VERSION, snoozed: {}}

function isSnoozeEntry(value: unknown): value is SnoozeEntry {
  if (typeof value !== 'object' || value === null) return false
  if (!('at' in value) || !('until' in value)) return false
  return typeof value.at === 'string' && typeof value.until === 'string'
}

function isRecordOfEntries(value: unknown): value is Record<string, SnoozeEntry> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(isSnoozeEntry)
}

/**
 * Parses the `removed` map the same defensive way `snoozed` is parsed.
 * Returns `undefined` when there is nothing valid to keep, so a parsed state
 * omits the field entirely — matching a stored document written before it
 * existed (see {@link SnoozeState.removed}).
 */
function parseRemoved(value: unknown): SnoozeState['removed'] {
  if (typeof value !== 'object' || value === null) return undefined

  const removed: NonNullable<SnoozeState['removed']> = {}
  for (const [source, items] of Object.entries(value)) {
    if (isRecordOfEntries(items) && Object.keys(items).length > 0) removed[source] = items
  }

  return Object.keys(removed).length > 0 ? removed : undefined
}

/**
 * Parses a stored value, discarding anything that is not what we wrote.
 *
 * @public
 */
export function parseSnoozes(value: unknown): SnoozeState {
  if (typeof value !== 'object' || value === null) return EMPTY_SNOOZES
  if (!('version' in value) || value.version !== SNOOZE_VERSION) return EMPTY_SNOOZES
  if (!('snoozed' in value) || typeof value.snoozed !== 'object' || value.snoozed === null) {
    return EMPTY_SNOOZES
  }

  const snoozed: SnoozeState['snoozed'] = {}
  for (const [source, items] of Object.entries(value.snoozed)) {
    if (isRecordOfEntries(items)) snoozed[source] = items
  }

  const removed = 'removed' in value ? parseRemoved(value.removed) : undefined

  return removed ? {version: SNOOZE_VERSION, snoozed, removed} : {version: SNOOZE_VERSION, snoozed}
}

/**
 * Drops entries whose wake time has already passed.
 *
 * Unlike a dismissal, a snoozed entry has no reason to be kept once it is
 * over: `isSnoozed` already stops hiding it the moment `until` passes, so
 * pruning here is only storage hygiene, not a behaviour change.
 *
 * Tombstones in `removed` reuse this exact rule rather than a second policy:
 * each one carries the `until` of the snooze it woke, and is dropped once
 * that same time has passed.
 */
export function pruneSnoozes(state: SnoozeState, now = Date.now()): SnoozeState {
  const snoozed: SnoozeState['snoozed'] = {}
  const removed: NonNullable<SnoozeState['removed']> = {}

  const keepActive = (items: Record<string, SnoozeEntry>) =>
    Object.fromEntries(
      Object.entries(items).filter(([, entry]) => {
        const until = Date.parse(entry.until)
        return Number.isFinite(until) && until > now
      }),
    )

  for (const [source, items] of Object.entries(state.snoozed)) {
    const kept = keepActive(items)
    if (Object.keys(kept).length > 0) snoozed[source] = kept
  }

  for (const [source, items] of Object.entries(state.removed ?? {})) {
    const kept = keepActive(items)
    if (Object.keys(kept).length > 0) removed[source] = kept
  }

  return Object.keys(removed).length > 0
    ? {version: SNOOZE_VERSION, snoozed, removed}
    : {version: SNOOZE_VERSION, snoozed}
}

/**
 * Whether an item is currently asleep.
 *
 * Mirrors {@link isDismissed}'s change-detection: a snooze says "not now, but
 * I have seen this version", not "hide no matter what happens to it" — an
 * item that changes after being snoozed wakes early, same as a dismissal
 * does. An entry whose `until` cannot be parsed is treated as not snoozed
 * rather than snoozed forever — corrupted data should fail open.
 *
 * @public
 */
export function isSnoozed(
  state: SnoozeState,
  source: string,
  itemId: string,
  now: number,
  itemChangedAt?: string,
): boolean {
  const entry = state.snoozed[source]?.[itemId]
  if (!entry) return false

  const until = Date.parse(entry.until)
  if (!Number.isFinite(until) || until <= now) return false
  if (!itemChangedAt) return true

  const changed = Date.parse(itemChangedAt)
  const at = Date.parse(entry.at)
  if (!Number.isFinite(changed) || !Number.isFinite(at)) return true

  return changed <= at
}

export function withSnooze(
  state: SnoozeState,
  source: string,
  itemId: string,
  until: string,
  at = new Date().toISOString(),
): SnoozeState {
  return {
    version: SNOOZE_VERSION,
    snoozed: {...state.snoozed, [source]: {...state.snoozed[source], [itemId]: {at, until}}},
  }
}

/**
 * Wakes an item early — the "Wake now" action in the Snoozed tab.
 *
 * Tombstones the wake so a merge can tell it apart from "never snoozed" (see
 * `mergeSnoozes`), copying the woken entry's own `until` into the tombstone.
 * If the item was not actually in `state.snoozed` — not reachable through the
 * Snoozed tab's own UI, which only offers "Wake now" for an entry it is
 * currently showing — there is nothing to protect against re-merging, so no
 * tombstone is recorded.
 */
export function withoutSnooze(
  state: SnoozeState,
  source: string,
  itemId: string,
  at = new Date().toISOString(),
): SnoozeState {
  const existing = state.snoozed[source]?.[itemId]
  const {[itemId]: _removedEntry, ...rest} = state.snoozed[source] ?? {}
  const snoozed = {...state.snoozed}

  if (Object.keys(rest).length > 0) snoozed[source] = rest
  else delete snoozed[source]

  if (!existing) return {version: SNOOZE_VERSION, snoozed}

  const removed = {
    ...state.removed,
    [source]: {...state.removed?.[source], [itemId]: {at, until: existing.until}},
  }

  return {version: SNOOZE_VERSION, snoozed, removed}
}

/** One side's candidate entry for a given source/item key, used by the
 * winner-picking logic in {@link mergeSnoozes}. */
interface Candidate {
  kind: 'snoozed' | 'removed'
  entry: SnoozeEntry
  time: number
}

/**
 * Picks the candidate whose entry has the latest parseable `at`, preferring
 * the earlier-listed candidate on a tie or when none parse — the rule
 * `mergeSnoozes` has always used for two `snoozed` entries, generalized to
 * `removed` entries too.
 */
function latestCandidate(candidates: readonly Candidate[]): Candidate | undefined {
  let winner: Candidate | undefined
  for (const candidate of candidates) {
    if (!winner) {
      winner = candidate
      continue
    }
    const winnerParses = Number.isFinite(winner.time)
    const candidateParses = Number.isFinite(candidate.time)

    if (!winnerParses && candidateParses) {
      winner = candidate
    } else if (winnerParses && candidateParses && candidate.time > winner.time) {
      winner = candidate
    }
  }
  return winner
}

/**
 * Unions two snooze states, keeping the more recently-set entry when the same
 * source and item appear in both — now across *both* maps, so a wake
 * (`removed`) can beat a snooze (`snoozed`) or lose to one, the same way two
 * snoozes compare (by `at`).
 *
 * Same reasoning as {@link mergeDismissals}: a late-resolving load must not
 * silently drop a snooze the editor already set, or a wake the editor already
 * clicked — without the `removed` side of this comparison this was a pure
 * union, so a load resolving after "Wake now" would put the snooze straight
 * back.
 */
export function mergeSnoozes(a: SnoozeState, b: SnoozeState): SnoozeState {
  const snoozed: SnoozeState['snoozed'] = {}
  const removed: NonNullable<SnoozeState['removed']> = {}
  const sources = new Set([
    ...Object.keys(a.snoozed),
    ...Object.keys(b.snoozed),
    ...Object.keys(a.removed ?? {}),
    ...Object.keys(b.removed ?? {}),
  ])

  for (const source of sources) {
    const snoozedA = a.snoozed[source] ?? {}
    const snoozedB = b.snoozed[source] ?? {}
    const removedA = a.removed?.[source] ?? {}
    const removedB = b.removed?.[source] ?? {}

    const itemIds = new Set([
      ...Object.keys(snoozedA),
      ...Object.keys(snoozedB),
      ...Object.keys(removedA),
      ...Object.keys(removedB),
    ])

    const items: Record<string, SnoozeEntry> = {}
    const tombstones: Record<string, SnoozeEntry> = {}

    for (const itemId of itemIds) {
      const candidates: Candidate[] = []
      const consider = (kind: Candidate['kind'], entry: SnoozeEntry | undefined) => {
        if (entry) candidates.push({kind, entry, time: Date.parse(entry.at)})
      }
      // Side A first, then side B, so a full tie (or both unparseable) keeps
      // side A's value — matching the existing two-snoozed-entries rule.
      consider('snoozed', snoozedA[itemId])
      consider('removed', removedA[itemId])
      consider('snoozed', snoozedB[itemId])
      consider('removed', removedB[itemId])

      const winner = latestCandidate(candidates)
      if (!winner) continue

      if (winner.kind === 'snoozed') items[itemId] = winner.entry
      else tombstones[itemId] = winner.entry
    }

    if (Object.keys(items).length > 0) snoozed[source] = items
    if (Object.keys(tombstones).length > 0) removed[source] = tombstones
  }

  return Object.keys(removed).length > 0
    ? {version: SNOOZE_VERSION, snoozed, removed}
    : {version: SNOOZE_VERSION, snoozed}
}
