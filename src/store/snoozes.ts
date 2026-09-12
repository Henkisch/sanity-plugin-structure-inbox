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
 */
export interface SnoozeState {
  version: 1
  /** `{[sourceName]: {[itemId]: SnoozeEntry}}` */
  snoozed: Record<string, Record<string, SnoozeEntry>>
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

/** Parses a stored value, discarding anything that is not what we wrote. */
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

  return {version: SNOOZE_VERSION, snoozed}
}

/**
 * Drops entries whose wake time has already passed.
 *
 * Unlike a dismissal, a snoozed entry has no reason to be kept once it is
 * over: `isSnoozed` already stops hiding it the moment `until` passes, so
 * pruning here is only storage hygiene, not a behaviour change.
 */
export function pruneSnoozes(state: SnoozeState, now = Date.now()): SnoozeState {
  const snoozed: SnoozeState['snoozed'] = {}

  for (const [source, items] of Object.entries(state.snoozed)) {
    const kept = Object.entries(items).filter(([, entry]) => {
      const until = Date.parse(entry.until)
      return Number.isFinite(until) && until > now
    })
    if (kept.length > 0) snoozed[source] = Object.fromEntries(kept)
  }

  return {version: SNOOZE_VERSION, snoozed}
}

/**
 * Whether an item is currently asleep.
 *
 * Mirrors {@link isDismissed}'s change-detection: a snooze says "not now, but
 * I have seen this version", not "hide no matter what happens to it" — an
 * item that changes after being snoozed wakes early, same as a dismissal
 * does. An entry whose `until` cannot be parsed is treated as not snoozed
 * rather than snoozed forever — corrupted data should fail open.
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

/** Wakes an item early — the "Wake now" action in the Snoozed tab. */
export function withoutSnooze(state: SnoozeState, source: string, itemId: string): SnoozeState {
  const {[itemId]: _removed, ...rest} = state.snoozed[source] ?? {}
  const snoozed = {...state.snoozed}

  if (Object.keys(rest).length > 0) snoozed[source] = rest
  else delete snoozed[source]

  return {version: SNOOZE_VERSION, snoozed}
}

/**
 * Unions two snooze states, keeping the more recently-set entry when the same
 * source and item appear in both. Same reasoning as {@link mergeDismissals}: a
 * late-resolving load must not silently drop a snooze the editor already set.
 */
export function mergeSnoozes(a: SnoozeState, b: SnoozeState): SnoozeState {
  const snoozed: SnoozeState['snoozed'] = {}
  const sources = new Set([...Object.keys(a.snoozed), ...Object.keys(b.snoozed)])

  for (const source of sources) {
    const itemsA = a.snoozed[source] ?? {}
    const itemsB = b.snoozed[source] ?? {}
    const items: Record<string, SnoozeEntry> = {...itemsA}

    for (const [itemId, entryB] of Object.entries(itemsB)) {
      const entryA = items[itemId]
      if (!entryA) {
        items[itemId] = entryB
        continue
      }

      const timeA = Date.parse(entryA.at)
      const timeB = Date.parse(entryB.at)

      if (!Number.isFinite(timeA) && Number.isFinite(timeB)) {
        items[itemId] = entryB
      } else if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeB > timeA) {
        items[itemId] = entryB
      }
    }

    if (Object.keys(items).length > 0) snoozed[source] = items
  }

  return {version: SNOOZE_VERSION, snoozed}
}
