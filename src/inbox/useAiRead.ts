import {useCallback, useRef, useState} from 'react'

/**
 * One AI read: its in-flight guard, its staleness guard, its state and its
 * error logging.
 *
 * The two refs guard different things, and conflating them is how this
 * pattern drifted in its seventh copy (`MergedList`'s snooze suggestion had
 * the second without the first, so a double-click billed twice):
 *
 * - the **in-flight** ref gates the *request*. A `status === 'loading'` state
 *   check is not enough: two clicks landing in the same React batch both run
 *   before React commits the first one's `setState`, so a state read is stale
 *   for both and both fire. A `ref.current` write is visible to the very next
 *   line of JS.
 * - the **request-id** ref decides which *response* is authoritative if one
 *   somehow still lands late.
 *
 * `run` resolving `null` is treated as a silent (unlogged) `'error'` — the
 * exact behaviour every one of this hook's own call sites already had for
 * its own "nothing to call, e.g. no agent client configured" branch. A read
 * whose "nothing found" case is a real, non-error outcome (`MergedList`'s
 * snooze suggestion: the AI genuinely had no date to suggest) encodes that
 * inside its own `T` instead of as `null`, and maps it to its own render
 * state at the call site — see `handleSuggestSnooze` in `MergedList.tsx`.
 */
export type AiReadState<T> =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; data: T}
  | {status: 'error'}

export interface UseAiReadResult<T> {
  state: AiReadState<T>
  /** Starts a request. A no-op while one is already in flight. */
  start: () => void
  /** Back to `{status: 'idle'}` — what every existing "Dismiss"/"Dismiss all" button already did. */
  reset: () => void
  /**
   * Updates the `data` of a `'done'` state in place, without re-running the
   * read — the one thing `start`/`reset` don't cover: a per-item dismiss/add
   * that removes one entry from an already-`'done'` result. A no-op unless
   * the current state actually is `'done'`, the same guard every existing
   * hand-rolled updater (`setSuggestions`/`setContentGapsResult`) already
   * had inline.
   */
  update: (updater: (data: T) => T) => void
}

/**
 * `errorLabel` becomes `[sanity-plugin-structure-inbox] ${errorLabel}` in the
 * one `console.error` call a rejected `run()` gets — the exact prefix, and
 * per-read message, every existing handler already used by hand.
 *
 * `start` depends on `run`/`errorLabel` exactly like every pre-extraction
 * handler's own `useCallback` already depended on the values it closed over
 * (`agentClient`, `openRows`, `context`, …) — so `start` is referentially
 * stable whenever a render leaves them unchanged, and only changes identity
 * when the caller's own data actually did. `reset` and `update` close over
 * nothing but `setState` (itself permanently stable by React's own
 * contract), so they never change identity at all.
 */
export function useAiRead<T>(run: () => Promise<T | null>, errorLabel: string): UseAiReadResult<T> {
  const [state, setState] = useState<AiReadState<T>>({status: 'idle'})

  // See this file's own doc comment above for why these are two separate
  // refs, not one.
  const inFlightRef = useRef(false)
  const requestRef = useRef(0)

  const start = useCallback(() => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const requestId = ++requestRef.current
    setState({status: 'loading'})

    run()
      .then((data) => {
        if (requestId === requestRef.current) {
          setState(data === null ? {status: 'error'} : {status: 'done', data})
        }
        return undefined
      })
      .catch((error: unknown) => {
        console.error(`[sanity-plugin-structure-inbox] ${errorLabel}`, error)
        if (requestId === requestRef.current) setState({status: 'error'})
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [run, errorLabel])

  const reset = useCallback(() => setState({status: 'idle'}), [])

  const update = useCallback((updater: (data: T) => T) => {
    setState((current) => (current.status === 'done' ? {status: 'done', data: updater(current.data)} : current))
  }, [])

  return {state, start, reset, update}
}

/**
 * Maps an `AiReadState<T>` back to the `{status: 'done'} & T` shape every
 * pre-extraction handler's own state used (`{status: 'done', message}`,
 * `{status: 'done', items}`, …) — so a call site whose `T` already *is* that
 * done-state's extra fields can keep its existing variable name and every
 * downstream read of it (`summary.message`, `suggestions.items`, …)
 * unchanged.
 */
export function unwrapAiRead<T extends object>(
  state: AiReadState<T>,
): {status: 'idle'} | {status: 'loading'} | ({status: 'done'} & T) | {status: 'error'} {
  return state.status === 'done' ? {status: 'done', ...state.data} : state
}
