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
   * lists, never on neither.
   */
  transferTo: (id: string, toUserId: string) => Promise<void>
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

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: TODOS_TYPE, [TODOS_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[TODOS_FIELD]: value}))
      .commit({visibility: 'async'})
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
      const raw = await client.fetch<string | null>(`*[_id == $id][0].${TODOS_FIELD}`, {
        id: toDocumentId,
      })
      const targetState = parseTodos(typeof raw === 'string' ? JSON.parse(raw) : null)
      const value = JSON.stringify(withTransferredTodo(targetState, item))

      await client
        .transaction()
        .createIfNotExists({_id: toDocumentId, _type: TODOS_TYPE, [TODOS_FIELD]: value})
        .patch(toDocumentId, (patch) => patch.set({[TODOS_FIELD]: value}))
        .commit({visibility: 'async'})

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
