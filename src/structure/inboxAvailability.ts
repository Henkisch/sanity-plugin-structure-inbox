/**
 * Whether the Inbox pane can actually be resolved, keyed by tool name.
 *
 * The landing redirect and the pane wiring live in different parts of the
 * config — `studio.components.activeToolLayout` and `tools` — and only the
 * second one can tell whether the wiring succeeded, because that answer depends
 * on what the developer's structure resolver returns at render time.
 *
 * A synchronous resolver settles this before the redirect effect ever reads
 * it, so a plain read would be enough there. An async resolver does not: it
 * can still be pending when the effect first runs, and nothing re-runs that
 * effect on its own. So this is a small subscribable store rather than a bare
 * map — `createActiveToolLayout` subscribes via `useSyncExternalStore`,
 * which re-renders (and so re-runs the effect) once the promise settles and
 * the answer actually changes.
 *
 * @internal
 */
const availability = new Map<string, boolean>()

const listeners = new Set<() => void>()

/** @internal */
export function setInboxAvailable(toolName: string, available: boolean): void {
  if (availability.get(toolName) === available) return

  availability.set(toolName, available)
  for (const listener of listeners) listener()
}

/** @internal */
export function isInboxAvailable(toolName: string): boolean {
  return availability.get(toolName) === true
}

/**
 * Subscribes to changes in availability, for any tool name. `listener` takes
 * no arguments and is not told which tool name changed — call `isInboxAvailable`
 * to find out — which keeps this usable directly as `useSyncExternalStore`'s
 * subscribe function.
 *
 * @internal
 */
export function subscribeInboxAvailability(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** @internal */
export function resetInboxAvailability(): void {
  availability.clear()
}
