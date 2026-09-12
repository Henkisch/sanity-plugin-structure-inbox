import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../constants'
import {EMPTY_TODOS, mergeTodos, parseTodos, type TodosState, withTodo} from './todos'

/** Never registered in the Studio schema — see `useDismissals` for why. */
const TODOS_TYPE = 'structureInbox.todos'

const TODOS_FIELD = 'items'

function todosDocumentId(userId: string): string {
  return `${TODOS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

export interface Todos {
  state: TodosState
  add: (title: string) => void
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

    dirtyRef.current = false

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: TODOS_TYPE, [TODOS_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[TODOS_FIELD]: value}))
      .commit({visibility: 'async'})
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not save todos', error)
      })
  }, [client, documentId, state])

  const add = useCallback((title: string) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => withTodo(current, title))
  }, [])

  return useMemo(() => ({state, add}), [state, add])
}
