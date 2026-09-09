/**
 * The shape stored under the dismissals key.
 *
 * Versioned, and read defensively: a value written by a future version of this
 * plugin is treated as absent rather than coerced, so an editor who downgrades
 * sees an empty inbox state instead of a crash.
 */
export interface DismissalState {
  version: 1
  /** `{[sourceName]: {[itemId]: ISO timestamp}}` */
  dismissed: Record<string, Record<string, string>>
}

export const DISMISSAL_VERSION = 1

/**
 * How long a dismissal is remembered.
 *
 * Dismissals are the only thing here that grows without bound: an item can
 * vanish from its source at any time, and nothing tells us it is gone, so
 * entries can never be pruned by checking against live items. Ageing them out
 * keeps the stored value small, and an item still present after this long is
 * one the editor has evidently chosen to live with.
 */
export const DISMISSAL_TTL_DAYS = 90

export const EMPTY_DISMISSALS: DismissalState = {version: DISMISSAL_VERSION, dismissed: {}}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

/** Parses a stored value, discarding anything that is not what we wrote. */
export function parseDismissals(value: unknown): DismissalState {
  if (typeof value !== 'object' || value === null) return EMPTY_DISMISSALS
  if (!('version' in value) || value.version !== DISMISSAL_VERSION) return EMPTY_DISMISSALS
  if (!('dismissed' in value) || typeof value.dismissed !== 'object' || value.dismissed === null) {
    return EMPTY_DISMISSALS
  }

  const dismissed: DismissalState['dismissed'] = {}
  for (const [source, items] of Object.entries(value.dismissed)) {
    if (isRecordOfStrings(items)) dismissed[source] = items
  }

  return {version: DISMISSAL_VERSION, dismissed}
}

/** Drops entries older than {@link DISMISSAL_TTL_DAYS}. */
export function pruneDismissals(state: DismissalState, now = Date.now()): DismissalState {
  const cutoff = now - DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  const dismissed: DismissalState['dismissed'] = {}

  for (const [source, items] of Object.entries(state.dismissed)) {
    const kept = Object.entries(items).filter(([, at]) => {
      const time = Date.parse(at)
      // An unparseable timestamp is one we did not write; drop it.
      return Number.isFinite(time) && time >= cutoff
    })
    if (kept.length > 0) dismissed[source] = Object.fromEntries(kept)
  }

  return {version: DISMISSAL_VERSION, dismissed}
}

export function isDismissed(state: DismissalState, source: string, itemId: string): boolean {
  return typeof state.dismissed[source]?.[itemId] === 'string'
}

export function withDismissal(
  state: DismissalState,
  source: string,
  itemId: string,
  at = new Date().toISOString(),
): DismissalState {
  return {
    version: DISMISSAL_VERSION,
    dismissed: {...state.dismissed, [source]: {...state.dismissed[source], [itemId]: at}},
  }
}

export function withoutDismissal(
  state: DismissalState,
  source: string,
  itemId: string,
): DismissalState {
  const {[itemId]: _removed, ...rest} = state.dismissed[source] ?? {}
  const dismissed = {...state.dismissed}

  if (Object.keys(rest).length > 0) dismissed[source] = rest
  else delete dismissed[source]

  return {version: DISMISSAL_VERSION, dismissed}
}
