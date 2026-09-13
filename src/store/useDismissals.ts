import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../constants'
import {
  type DismissalState,
  EMPTY_DISMISSALS,
  mergeDismissals,
  parseDismissals,
  pruneDismissals,
  withDismissal,
  withoutDismissal,
} from './dismissals'

/**
 * The document type dismissals are stored in.
 *
 * Deliberately never registered in the Studio schema: it is a preference, not
 * content, and an editor should not meet it in the structure tool, in search,
 * or in a reference picker. Writing an unregistered type through the client is
 * supported; only the Studio's own UI cares about registration.
 */
const DISMISSALS_TYPE = 'structureInbox.dismissals'

/**
 * The state is stored as a JSON string in one field rather than as an object
 * map.
 *
 * Patch paths cannot address keys containing hyphens or dots, and every key
 * here is a document id or a source name — `drafts.9f2c-…` is the normal case,
 * not the exception. One opaque field sidesteps that entirely, at the cost of
 * last-write-wins if the same editor dismisses different items on two devices
 * at the same moment. Losing one dismissal in that race is not worth a merge
 * protocol.
 */
const DISMISSALS_FIELD = 'dismissed'

/** Document ids allow a limited alphabet, and user ids are opaque strings. */
function dismissalsDocumentId(userId: string): string {
  return `${DISMISSALS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

export interface Dismissals {
  state: DismissalState
  dismiss: (source: string, itemId: string) => void
  restore: (source: string, itemId: string) => void
}

/**
 * Per-editor dismissals, stored in the dataset.
 *
 * Sanity's own `/users/me/keyvalue` store would be the natural home for a
 * preference like this — it is where the Structure tool keeps its pane
 * settings — but the endpoint accepts only an allowlist of Sanity's own keys
 * and rejects anything a plugin writes with `Key '…' is not allowed`. So a
 * user-scoped document it is: still per-user, still following the editor
 * between devices, at the cost of one small document per editor.
 *
 * State is held locally and updated optimistically, so ticking an item is
 * instant and a failed write costs the editor nothing beyond this session.
 */
export function useDismissals(neverExpireSources: readonly string[] = []): Dismissals {
  const client = useClient({apiVersion: API_VERSION})
  const currentUser = useCurrentUser()
  const userId = currentUser?.id

  const [state, setState] = useState<DismissalState>(EMPTY_DISMISSALS)
  // Distinguishes "this is what the server had" from "the editor just changed
  // something", so loading a value never writes it straight back. A ref rather
  // than state: it is bookkeeping between an event and an effect, and nothing
  // renders from it.
  const dirtyRef = useRef(false)
  // Separate from `dirtyRef`, which the persist effect clears as soon as it
  // fires: this stays `true` for the rest of the session once any tick has
  // happened, even after that tick is safely persisted. The load effect needs
  // to know not just "is there an unpersisted edit right now" but "has local
  // state ever diverged from a fresh mount", since a late load resolving after
  // an edit was already written would otherwise stomp it right back out.
  const hasLocalEditRef = useRef(false)
  // Whether the load effect has settled — successfully or with "nothing
  // stored" — at least once. The persist effect uses this to refuse to write
  // until a real read has happened, since writing beforehand risks overwriting
  // server state this session never saw.
  const loadedRef = useRef(false)

  const documentId = useMemo(() => (userId ? dismissalsDocumentId(userId) : null), [userId])

  useEffect(() => {
    if (!documentId) return undefined

    let cancelled = false

    client
      .fetch<string | null>(`*[_id == $id][0].${DISMISSALS_FIELD}`, {id: documentId})
      .then((raw) => {
        if (cancelled) return undefined

        const parsed = parseDismissals(typeof raw === 'string' ? JSON.parse(raw) : null)

        // Only reached once parsing has actually succeeded, so a malformed
        // stored value still falls through to `.catch()` below and leaves
        // `loadedRef` clear — a missing document (`raw === null`) resolves to
        // `EMPTY_DISMISSALS` above without throwing, which is a successful
        // read of "nothing stored", so it still counts as loaded.
        loadedRef.current = true

        if (!hasLocalEditRef.current) {
          // Nothing has happened locally yet, so the server value is simply
          // the truth.
          setState(parsed)
        } else {
          // The editor already ticked something while this fetch was in
          // flight. Replacing state with the (now stale) server value would
          // silently drop that tick, so the two are merged instead — the
          // local value wins ties because it is newer. `dirtyRef` is
          // deliberately left untouched here: if an edit is still pending it
          // stays pending so the persist effect writes the merged union, and
          // if it was already persisted, leaving it clear avoids a redundant
          // write of a value the server already has.
          setState((current) => mergeDismissals(parsed, current))
        }

        return undefined
      })
      .catch((error: unknown) => {
        // A missing document is the normal first-run case and resolves to
        // `null` rather than throwing, so anything landing here is a real
        // failure — and an inbox showing everything beats one that will not
        // render. `loadedRef` stays `false`, so the persist effect will not
        // write local state over a server value it never actually saw.
        console.error('[sanity-plugin-structure-inbox] could not read dismissals', error)
      })

    return () => {
      cancelled = true
    }
  }, [client, documentId])

  // Persisting in an effect rather than inside the click handler keeps the
  // stored value derived from the state that actually rendered. A handler
  // would have to guess it, because a `setState` updater does not run until
  // React re-renders.
  useEffect(() => {
    if (!dirtyRef.current || !documentId || !loadedRef.current) return

    dirtyRef.current = false

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[DISMISSALS_FIELD]: value}))
      .commit({visibility: 'async'})
      .catch((error: unknown) => {
        // The local state stands for this session, so the tick the editor just
        // made still holds until they reload.
        console.error('[sanity-plugin-structure-inbox] could not save dismissals', error)
      })
  }, [client, documentId, state])

  const update = useCallback(
    (next: (current: DismissalState) => DismissalState) => {
      // Pruned on write rather than on read: reads happen on every render, and
      // an editor who never dismisses anything should not pay for maintenance
      // of a value they are not growing.
      dirtyRef.current = true
      hasLocalEditRef.current = true
      setState((current) => pruneDismissals(next(current), Date.now(), neverExpireSources))
    },
    [neverExpireSources],
  )

  const dismiss = useCallback(
    (source: string, itemId: string) => update((current) => withDismissal(current, source, itemId)),
    [update],
  )

  const restore = useCallback(
    (source: string, itemId: string) =>
      update((current) => withoutDismissal(current, source, itemId)),
    [update],
  )

  return useMemo(() => ({state, dismiss, restore}), [state, dismiss, restore])
}
