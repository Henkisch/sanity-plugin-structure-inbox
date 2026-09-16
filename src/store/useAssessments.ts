import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../constants'
import {type InboxAssessment} from '../inbox/types'
import {
  type AssessmentState,
  EMPTY_ASSESSMENTS,
  parseAssessments,
  pruneAssessments,
  readAssessment,
  withAssessment,
} from './assessments'

/** Never registered in the Studio schema — see `useDismissals` for why. */
const ASSESSMENTS_TYPE = 'structureInbox.assessments'

/** Same reasoning as `useDismissals`'s own `DISMISSALS_FIELD` — one opaque field sidesteps patch-path key restrictions entirely. */
const ASSESSMENTS_FIELD = 'assessed'

function assessmentsDocumentId(userId: string): string {
  return `${ASSESSMENTS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

export interface Assessments {
  state: AssessmentState
  read: (source: string, itemId: string, changedAt: string | undefined) => InboxAssessment | null
  write: (source: string, itemId: string, assessment: InboxAssessment, changedAt: string | undefined) => void
}

/**
 * Per-editor cache of AI assessments, keyed on the item's own `changedAt` —
 * the same freshness signal a dismissal already expires against, so an
 * assessment goes stale on exactly the signal a tick does. Only items that
 * supply `changedAt` are ever cached or read (see `readAssessment`'s own doc
 * comment): a confidently-wrong cached read on a since-edited item is the one
 * outcome this cache must never produce.
 *
 * Per-editor, not shared across the team: this store's own JSON-string-field
 * shape (see `useDismissals`'s own doc comment) is last-write-wins on a
 * concurrent write, which is an acceptable trade for one editor's own two
 * tabs and not for a document N editors would write to all day — a shared
 * cache is a different, larger design with its own merge story, not an
 * extension of this one.
 *
 * State is held locally and updated optimistically, same shape as
 * `useDismissals` — see that hook's own comments for the full rationale on
 * the `dirtyRef`/`hasLocalEditRef`/`loadedRef` ordering guards.
 */
export function useAssessments(): Assessments {
  const client = useClient({apiVersion: API_VERSION})
  const currentUser = useCurrentUser()
  const userId = currentUser?.id

  const [state, setState] = useState<AssessmentState>(EMPTY_ASSESSMENTS)
  const dirtyRef = useRef(false)
  const hasLocalEditRef = useRef(false)
  const loadedRef = useRef(false)

  const documentId = useMemo(() => (userId ? assessmentsDocumentId(userId) : null), [userId])

  useEffect(() => {
    if (!documentId) return undefined

    let cancelled = false

    client
      .fetch<string | null>(`*[_id == $id][0].${ASSESSMENTS_FIELD}`, {id: documentId})
      .then((raw) => {
        if (cancelled) return undefined

        const parsed = parseAssessments(typeof raw === 'string' ? JSON.parse(raw) : null)
        loadedRef.current = true

        // Unlike `useDismissals`, a late-resolving load here never needs to
        // merge with a local edit: a cache write only ever adds or replaces
        // one `[source][itemId]` entry, and the load either hasn't happened
        // yet (nothing local to lose) or already has (the local value is
        // strictly newer for that same key, so keeping it is correct) — there
        // is no cross-device concurrent-write case to reconcile the way a
        // dismissal's tick has.
        if (!hasLocalEditRef.current) setState(parsed)

        return undefined
      })
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not read assessments', error)
      })

    return () => {
      cancelled = true
    }
  }, [client, documentId])

  useEffect(() => {
    if (!dirtyRef.current || !documentId || !loadedRef.current) return

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: ASSESSMENTS_TYPE, [ASSESSMENTS_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[ASSESSMENTS_FIELD]: value}))
      .commit({visibility: 'async'})
      .then(() => {
        dirtyRef.current = false
        return undefined
      })
      .catch((error: unknown) => {
        // Left dirty on purpose: the write never actually landed, so the next
        // time this effect runs for any reason, it retries this same value
        // instead of silently treating a failed write as done.
        console.error('[sanity-plugin-structure-inbox] could not save assessments', error)
      })
  }, [client, documentId, state])

  const read = useCallback(
    (source: string, itemId: string, changedAt: string | undefined) =>
      readAssessment(state, source, itemId, changedAt),
    [state],
  )

  const write = useCallback(
    (source: string, itemId: string, assessment: InboxAssessment, changedAt: string | undefined) => {
      if (!changedAt) return

      dirtyRef.current = true
      hasLocalEditRef.current = true
      setState((current) => pruneAssessments(withAssessment(current, source, itemId, assessment, changedAt)))
    },
    [],
  )

  return useMemo(() => ({state, read, write}), [state, read, write])
}
