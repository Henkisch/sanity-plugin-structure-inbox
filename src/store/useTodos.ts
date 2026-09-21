import {ClientError, type SanityClient} from '@sanity/client'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../constants'
import {
  EMPTY_TODOS,
  mergeTodos,
  parseTodos,
  type TodoInput,
  type TodosState,
  withoutTodo,
  withTodo,
  withTransferredTodo,
  withUpdatedTodo,
} from './todos'

/** Never registered in the Studio schema — see `useDismissals` for why. */
const TODOS_TYPE = 'structureInbox.todos'

const TODOS_FIELD = 'items'

function todosDocumentId(userId: string): string {
  return `${TODOS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

export interface Todos {
  state: TodosState
  add: (input: TodoInput) => void
  /** Removes a todo for good — see `withoutTodo`. */
  remove: (id: string) => void
  /** Edits a todo in place — see `withUpdatedTodo`. */
  update: (id: string, input: TodoInput) => void
  /**
   * Moves a todo out of this editor's own list and into `toUserId`'s —
   * see `withTransferredTodo`'s own doc comment for why the item keeps its
   * identity rather than becoming a new one. Writes the recipient's
   * document *before* clearing this editor's own copy, so a failed write
   * never loses the todo outright — worst case it briefly exists on both
   * lists, never on neither. The write itself is revision-guarded and
   * retried on conflict (see the implementation), so two transfers landing
   * on the same recipient close together can't silently clobber one
   * another either.
   */
  transferTo: (id: string, toUserId: string) => Promise<void>
}

/**
 * Fetch-merge-write against one todos document, revision-guarded and retried
 * on conflict rather than a blind `.set()`. Shared by `transferTo` (which
 * merges a handed-off todo into the recipient's list) and the persist effect
 * (which merges this editor's own local list over whatever else has landed
 * since it loaded) — the only two writers of a todos document, and the only
 * part that differs between them is *how* the fetched server state is merged
 * with what the caller wants to write, which is why `merge` is a parameter
 * rather than this being two near-identical copies of the loop.
 *
 * A blind `.set()` here is data loss, not a lost preference: a todo is
 * content the editor typed, with no document behind it, unlike the
 * dismissals/snoozes/assessments stores, whose last-write-wins is a
 * deliberate, accepted trade-off (see `useDismissals.ts`). If someone later
 * "harmonises" the four per-editor stores, that distinction — todos are
 * authored content, the other three are preferences — is the thing not to
 * lose.
 */
async function writeTodosMerged(
  client: SanityClient,
  documentId: string,
  merge: (serverState: TodosState) => TodosState,
): Promise<void> {
  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // This loop IS a fetch-merge-write retry: each attempt must see
    // whatever the *previous* attempt (or someone else's concurrent
    // write) actually committed before deciding what to write next, so
    // the three awaits below are inherently sequential, not a burst to
    // parallelize — see `mapWithConcurrency` in `src/inbox/concurrency.ts`
    // for the same reasoning applied to a different loop.
    // eslint-disable-next-line no-await-in-loop -- see comment above
    const existing = await client.fetch<{_rev: string; value: string | null} | null>(
      `*[_id == $id][0]{_rev, "value": ${TODOS_FIELD}}`,
      {id: documentId},
    )
    const serverState = parseTodos(
      typeof existing?.value === 'string' ? JSON.parse(existing.value) : null,
    )
    const value = JSON.stringify(merge(serverState))

    try {
      if (existing) {
        // eslint-disable-next-line no-await-in-loop -- see the comment above the fetch, same reasoning
        await client
          .patch(documentId)
          .ifRevisionId(existing._rev)
          .set({[TODOS_FIELD]: value})
          .commit({visibility: 'async'})
      } else {
        // eslint-disable-next-line no-await-in-loop -- see the comment above the fetch, same reasoning
        await client.create(
          {_id: documentId, _type: TODOS_TYPE, [TODOS_FIELD]: value},
          {visibility: 'async'},
        )
      }
      return
    } catch (error) {
      const isConflict = error instanceof ClientError && error.statusCode === 409
      if (!isConflict || attempt === MAX_ATTEMPTS) throw error
      // Otherwise: someone else's write landed first — loop and retry
      // against a fresh fetch of whatever they just wrote.
    }
  }
}

/**
 * An editor's personal todo list, stored in the dataset in a document of its
 * own — the list itself, not just done/not-done state, since a todo has
 * nowhere else to live. Same load/merge/persist shape as `useDismissals`; see
 * that hook's comments for the full rationale.
 */
export function useTodos(): Todos {
  const client = useClient({apiVersion: API_VERSION})
  const currentUser = useCurrentUser()
  const userId = currentUser?.id

  const [state, setState] = useState<TodosState>(EMPTY_TODOS)
  const dirtyRef = useRef(false)
  const hasLocalEditRef = useRef(false)
  const loadedRef = useRef(false)

  const documentId = useMemo(() => (userId ? todosDocumentId(userId) : null), [userId])

  useEffect(() => {
    if (!documentId) return undefined

    let cancelled = false

    client
      .fetch<string | null>(`*[_id == $id][0].${TODOS_FIELD}`, {id: documentId})
      .then((raw) => {
        if (cancelled) return undefined

        const parsed = parseTodos(typeof raw === 'string' ? JSON.parse(raw) : null)
        loadedRef.current = true

        if (!hasLocalEditRef.current) {
          setState(parsed)
        } else {
          setState((current) => mergeTodos(parsed, current))
        }

        return undefined
      })
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not read todos', error)
      })

    return () => {
      cancelled = true
    }
  }, [client, documentId])

  useEffect(() => {
    if (!dirtyRef.current || !documentId || !loadedRef.current) return

    // Fetch-merge-write (see `writeTodosMerged`), not a blind `.set()`: a
    // second tab (or the same editor on a second device) may have persisted
    // its own edits to this same document since this tab's copy loaded, and
    // a blind overwrite would silently discard them. `state` here is this
    // editor's own local list; the fetched `serverState` is whatever else
    // has actually landed — merging keeps both rather than one clobbering
    // the other. Order matters for `mergeTodos`' tie-break: on an id present
    // in both with no `updatedAt` difference, its first argument wins, so
    // `serverState` (already-committed work) wins a tie over `state` (this
    // tab's in-memory copy) rather than the other way around.
    writeTodosMerged(client, documentId, (serverState) => mergeTodos(serverState, state))
      .then(() => {
        dirtyRef.current = false
        return undefined
      })
      .catch((error: unknown) => {
        // Left dirty on purpose: the write never actually landed, so the next
        // time this effect runs for any reason, it retries this same value
        // instead of silently treating a failed write as done.
        console.error('[sanity-plugin-structure-inbox] could not save todos', error)
      })
  }, [client, documentId, state])

  const add = useCallback((input: TodoInput) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => withTodo(current, input))
  }, [])

  const remove = useCallback((id: string) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => withoutTodo(current, id))
  }, [])

  const update = useCallback((id: string, input: TodoInput) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => withUpdatedTodo(current, id, input))
  }, [])

  const transferTo = useCallback(
    async (id: string, toUserId: string) => {
      const item = state.items.find((todo) => todo.id === id)
      if (!item) return

      const toDocumentId = todosDocumentId(toUserId)

      // Two `transferTo` calls landing on the same recipient close together
      // (two editors handing off to the same third person, or one editor
      // transferring two todos back-to-back) would otherwise race: the
      // second call's own fetch can read a state that doesn't yet reflect
      // the first call's still-in-flight write, and a blind overwrite would
      // silently discard it. `writeTodosMerged` fetches, merges and retries
      // on conflict instead.
      await writeTodosMerged(client, toDocumentId, (serverState) =>
        withTransferredTodo(serverState, item),
      )

      dirtyRef.current = true
      hasLocalEditRef.current = true
      setState((current) => withoutTodo(current, id))
    },
    [client, state],
  )

  return useMemo(
    () => ({state, add, remove, update, transferTo}),
    [state, add, remove, update, transferTo],
  )
}
