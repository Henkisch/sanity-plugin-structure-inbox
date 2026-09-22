/**
 * The shape stored under the dismissals key.
 *
 * Versioned, and read defensively: a value written by a future version of this
 * plugin is treated as absent rather than coerced, so an editor who downgrades
 * sees an empty inbox state instead of a crash.
 *
 * @public
 */
export interface DismissalState {
  version: 1
  /** `{[sourceName]: {[itemId]: ISO timestamp}}` */
  dismissed: Record<string, Record<string, string>>
  /**
   * Keys the editor deliberately un-dismissed ("Mark as not done"), with when,
   * so a merge can tell "removed" apart from "never dismissed". Without this,
   * `mergeDismissals` is a pure union: a load that resolves after a local
   * restore puts the dismissal straight back — the restore silently undoing
   * itself, which reads as the click not having registered.
   *
   * Same shape as `dismissed`: `{[sourceName]: {[itemId]: ISO timestamp}}`.
   * Optional, and omitted entirely when empty, so a document written before
   * this field existed — or one with nothing currently tombstoned — still
   * parses and round-trips (see `parseDismissals`).
   */
  removed?: Record<string, Record<string, string>>
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

/**
 * Parses the `removed` map the same defensive way `dismissed` is parsed:
 * unknown shapes are discarded rather than coerced. Returns `undefined` when
 * there is nothing valid to keep, so a parsed state omits the field entirely
 * — matching a stored document written before it existed (see
 * {@link DismissalState.removed}).
 */
function parseRemoved(value: unknown): DismissalState['removed'] {
  if (typeof value !== 'object' || value === null) return undefined

  const removed: NonNullable<DismissalState['removed']> = {}
  for (const [source, items] of Object.entries(value)) {
    if (isRecordOfStrings(items) && Object.keys(items).length > 0) removed[source] = items
  }

  return Object.keys(removed).length > 0 ? removed : undefined
}

/**
 * Parses a stored value, discarding anything that is not what we wrote.
 *
 * @public
 */
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

  // Absent on any document written before this field existed — parsed as
  // `undefined` rather than `{}` so such a document still parses to a valid,
  // tombstone-free state (the backwards-compatibility case this plan is most
  // exposed to).
  const removed = 'removed' in value ? parseRemoved(value.removed) : undefined

  return removed
    ? {version: DISMISSAL_VERSION, dismissed, removed}
    : {version: DISMISSAL_VERSION, dismissed}
}

/**
 * Drops entries older than {@link DISMISSAL_TTL_DAYS} — except for a source
 * named in `neverExpireSources`, whose entries are kept regardless of age.
 *
 * Most sources want the TTL: an item still dismissed after this long is one
 * the editor has evidently chosen to live with (see the doc comment above),
 * and letting it resurface is a deliberate nudge. A source with no other way
 * to mark something truly finished — `todos` is the only built-in example —
 * has no such nudge to give: there is nothing else that could make a
 * genuinely-finished todo "not done" again, so ageing its dismissal out only
 * looks like data loss.
 *
 * Tombstones in `removed` are pruned on this same {@link DISMISSAL_TTL_DAYS}
 * cutoff (and the same `neverExpireSources` exemption) rather than a second
 * policy — a removal an editor made this long ago needs no protection against
 * a merge still in flight from back then.
 */
export function pruneDismissals(
  state: DismissalState,
  now = Date.now(),
  neverExpireSources: readonly string[] = [],
): DismissalState {
  const exempt = new Set(neverExpireSources)
  const cutoff = now - DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  const dismissed: DismissalState['dismissed'] = {}
  const removed: NonNullable<DismissalState['removed']> = {}

  const keepFresh = (items: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(items).filter(([, at]) => {
        const time = Date.parse(at)
        // An unparseable timestamp is one we did not write; drop it.
        return Number.isFinite(time) && time >= cutoff
      }),
    )

  for (const [source, items] of Object.entries(state.dismissed)) {
    if (exempt.has(source)) {
      dismissed[source] = items
      continue
    }

    const kept = keepFresh(items)
    if (Object.keys(kept).length > 0) dismissed[source] = kept
  }

  for (const [source, items] of Object.entries(state.removed ?? {})) {
    if (exempt.has(source)) {
      removed[source] = items
      continue
    }

    const kept = keepFresh(items)
    if (Object.keys(kept).length > 0) removed[source] = kept
  }

  return Object.keys(removed).length > 0
    ? {version: DISMISSAL_VERSION, dismissed, removed}
    : {version: DISMISSAL_VERSION, dismissed}
}

/**
 * Whether an item counts as done for this editor.
 *
 * The stored value is the moment it was ticked, which doubles as a freshness
 * check: an item that has changed since then comes back. Dismissing a draft
 * says "I have seen this version of it", not "never show me this document
 * again" — so someone editing it afterwards puts it back in the inbox, which is
 * what an inbox is for.
 *
 * `itemChangedAt` is a real modification time, never a due date or other
 * future-looking value — a future value would make the item look "changed"
 * before it was even ticked, and resurrect it immediately. Items with no
 * change time have no notion of changing, so for them a dismissal is
 * permanent until restored.
 *
 * @public
 */
export function isDismissed(
  state: DismissalState,
  source: string,
  itemId: string,
  itemChangedAt?: string,
): boolean {
  const dismissedAt = state.dismissed[source]?.[itemId]
  if (typeof dismissedAt !== 'string') return false
  if (!itemChangedAt) return true

  const changed = Date.parse(itemChangedAt)
  const ticked = Date.parse(dismissedAt)
  if (!Number.isFinite(changed) || !Number.isFinite(ticked)) return true

  return changed <= ticked
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
  at = new Date().toISOString(),
): DismissalState {
  const {[itemId]: _removed, ...rest} = state.dismissed[source] ?? {}
  const dismissed = {...state.dismissed}

  if (Object.keys(rest).length > 0) dismissed[source] = rest
  else delete dismissed[source]

  // Tombstone the removal, so a merge that later sees this source/item pair
  // dismissed again on the other side can tell whether that entry predates or
  // postdates this restore (see `mergeDismissals`).
  const removed = {...state.removed, [source]: {...state.removed?.[source], [itemId]: at}}

  return {version: DISMISSAL_VERSION, dismissed, removed}
}

/** One side's candidate value for a given source/item key, used by the
 * winner-picking logic in {@link mergeDismissals}. */
interface Candidate {
  kind: 'dismissed' | 'removed'
  at: string
  time: number
}

/**
 * Picks the candidate with the latest parseable timestamp, preferring the
 * earlier-listed candidate on a tie or when none parse — the same rule
 * `mergeDismissals` has always used for two `dismissed` entries, generalized
 * to `removed` entries too. An unparseable timestamp loses to a parseable
 * one, since it cannot be compared and a change we can date is more
 * trustworthy than one we cannot.
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
    // Otherwise `winner` already stands.
  }
  return winner
}

/**
 * Unions two dismissal states, keeping the later timestamp when the same
 * source and item appear in both — now across *both* maps, so a removal
 * (`removed`) can beat a dismissal (`dismissed`) or lose to one, the same way
 * two dismissals compare.
 *
 * Exists for the case where a load from the server resolves after the editor
 * has already ticked (or un-ticked) something locally: replacing state with
 * the server value would silently discard that edit, so the two are merged
 * instead. Without the `removed` side of this comparison, the merge is a pure
 * union that cannot express "this was deliberately removed" — a load
 * resolving after a local restore would put the dismissal straight back.
 */
export function mergeDismissals(a: DismissalState, b: DismissalState): DismissalState {
  const dismissed: DismissalState['dismissed'] = {}
  const removed: NonNullable<DismissalState['removed']> = {}
  const sources = new Set([
    ...Object.keys(a.dismissed),
    ...Object.keys(b.dismissed),
    ...Object.keys(a.removed ?? {}),
    ...Object.keys(b.removed ?? {}),
  ])

  for (const source of sources) {
    const dismissedA = a.dismissed[source] ?? {}
    const dismissedB = b.dismissed[source] ?? {}
    const removedA = a.removed?.[source] ?? {}
    const removedB = b.removed?.[source] ?? {}

    const itemIds = new Set([
      ...Object.keys(dismissedA),
      ...Object.keys(dismissedB),
      ...Object.keys(removedA),
      ...Object.keys(removedB),
    ])

    const items: Record<string, string> = {}
    const tombstones: Record<string, string> = {}

    for (const itemId of itemIds) {
      const candidates: Candidate[] = []
      const consider = (kind: Candidate['kind'], at: string | undefined) => {
        if (at !== undefined) candidates.push({kind, at, time: Date.parse(at)})
      }
      // Side A first, then side B, so a full tie (or both unparseable) keeps
      // side A's value — matching the existing two-dismissed-entries rule.
      consider('dismissed', dismissedA[itemId])
      consider('removed', removedA[itemId])
      consider('dismissed', dismissedB[itemId])
      consider('removed', removedB[itemId])

      const winner = latestCandidate(candidates)
      if (!winner) continue

      if (winner.kind === 'dismissed') items[itemId] = winner.at
      else tombstones[itemId] = winner.at
    }

    if (Object.keys(items).length > 0) dismissed[source] = items
    if (Object.keys(tombstones).length > 0) removed[source] = tombstones
  }

  return Object.keys(removed).length > 0
    ? {version: DISMISSAL_VERSION, dismissed, removed}
    : {version: DISMISSAL_VERSION, dismissed}
}
