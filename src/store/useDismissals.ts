import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {map} from 'rxjs/operators'
import {type KeyValueStoreValue, useKeyValueStore} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {
  type DismissalState,
  EMPTY_DISMISSALS,
  parseDismissals,
  pruneDismissals,
  withDismissal,
  withoutDismissal,
} from './dismissals'

const DISMISSALS_KEY = `${STRUCTURE_INBOX_NAMESPACE}.dismissed`

export interface Dismissals {
  state: DismissalState
  dismiss: (source: string, itemId: string) => void
  restore: (source: string, itemId: string) => void
}

/**
 * Per-editor dismissals, stored server-side.
 *
 * `useKeyValueStore` writes to Sanity's own `/users/me/keyvalue` endpoint — the
 * same one the Structure tool keeps its pane settings in. That makes this
 * per-user and per-project rather than per-browser, so an editor who ticks
 * something off at their desk does not meet it again on their laptop, and it
 * needs no schema and no dataset writes.
 *
 * The hook is `@internal` in Sanity's own typings, which is why every use of it
 * is confined to this file: replacing it means rewriting one module.
 */
export function useDismissals(): Dismissals {
  const keyValueStore = useKeyValueStore()

  const value$ = useMemo(
    () => keyValueStore.getKey(DISMISSALS_KEY).pipe(map((value) => parseDismissals(value))),
    [keyValueStore],
  )

  const state = useObservable(value$, EMPTY_DISMISSALS)

  const write = useCallback(
    (next: DismissalState) => {
      // Pruning on write rather than on read: reads happen on every render, and
      // an editor who never dismisses anything should never be made to pay for
      // maintenance of a value they are not growing.
      // The store's value type is structural JSON; our state is a named
      // interface, which TypeScript will not widen to an index signature on its
      // own. Round-tripping through JSON is both the coercion and the proof
      // that what we store is plain data.
      const value: KeyValueStoreValue = JSON.parse(JSON.stringify(pruneDismissals(next)))
      void keyValueStore.setKey(DISMISSALS_KEY, value)
    },
    [keyValueStore],
  )

  const dismiss = useCallback(
    (source: string, itemId: string) => write(withDismissal(state, source, itemId)),
    [state, write],
  )

  const restore = useCallback(
    (source: string, itemId: string) => write(withoutDismissal(state, source, itemId)),
    [state, write],
  )

  return useMemo(() => ({state, dismiss, restore}), [state, dismiss, restore])
}
