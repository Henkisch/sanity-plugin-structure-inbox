import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../constants'
import {
  EMPTY_SNOOZES,
  mergeSnoozes,
  parseSnoozes,
  pruneSnoozes,
  type SnoozeState,
  withoutSnooze,
  withSnooze,
} from './snoozes'

/**
 * A document type of its own, deliberately never registered in the Studio
 * schema — same reasoning as `structureInbox.dismissals`, see `useDismissals`.
 */
const SNOOZES_TYPE = 'structureInbox.snoozes'

/** One opaque field, for the same patch-path reason `useDismissals` gives. */
const SNOOZES_FIELD = 'snoozed'

function snoozesDocumentId(userId: string): string {
  return `${SNOOZES_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

export interface Snoozes {
  state: SnoozeState
  snooze: (source: string, itemId: string, until: string) => void
  wake: (source: string, itemId: string) => void
}

/**
 * Per-editor snoozes, stored in the dataset in a document of their own.
 *
 * A sibling of `useDismissals` rather than a field folded into it: the two
 * concerns don't share a lifecycle (a snooze expires on its own; a dismissal
 * doesn't), and keeping them apart means neither's persistence logic has to
 * reason about the other. The load/merge/persist dance below is the same
 * shape as `useDismissals` for the same reasons — see that hook's comments
 * for the full rationale.
 */
export function useSnoozes(): Snoozes {
  const client = useClient({apiVersion: API_VERSION})
  const currentUser = useCurrentUser()
  const userId = currentUser?.id

  const [state, setState] = useState<SnoozeState>(EMPTY_SNOOZES)
  const dirtyRef = useRef(false)
  const hasLocalEditRef = useRef(false)
  const loadedRef = useRef(false)

  const documentId = useMemo(() => (userId ? snoozesDocumentId(userId) : null), [userId])

  useEffect(() => {
    if (!documentId) return undefined

    let cancelled = false

    client
      .fetch<string | null>(`*[_id == $id][0].${SNOOZES_FIELD}`, {id: documentId})
      .then((raw) => {
        if (cancelled) return undefined

        const parsed = parseSnoozes(typeof raw === 'string' ? JSON.parse(raw) : null)
        loadedRef.current = true

        if (!hasLocalEditRef.current) {
          setState(parsed)
        } else {
          setState((current) => mergeSnoozes(parsed, current))
        }

        return undefined
      })
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not read snoozes', error)
      })

    return () => {
      cancelled = true
    }
  }, [client, documentId])

  useEffect(() => {
    if (!dirtyRef.current || !documentId || !loadedRef.current) return

    dirtyRef.current = false

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: SNOOZES_TYPE, [SNOOZES_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[SNOOZES_FIELD]: value}))
      .commit({visibility: 'async'})
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not save snoozes', error)
      })
  }, [client, documentId, state])

  const update = useCallback((next: (current: SnoozeState) => SnoozeState) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => pruneSnoozes(next(current)))
  }, [])

  const snooze = useCallback(
    (source: string, itemId: string, until: string) =>
      update((current) => withSnooze(current, source, itemId, until)),
    [update],
  )

  const wake = useCallback(
    (source: string, itemId: string) => update((current) => withoutSnooze(current, source, itemId)),
    [update],
  )

  return useMemo(() => ({state, snooze, wake}), [state, snooze, wake])
}
