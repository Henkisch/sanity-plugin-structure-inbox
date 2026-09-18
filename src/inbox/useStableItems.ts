import {useState} from 'react'

import {type InboxItem} from './types'

/**
 * Whether two values that turned up under the same key on two items are the
 * same as far as rendering a row goes.
 *
 * `===` for everything except the one nested shape `InboxItem` actually has
 * (`intent: {type, params}`), which is compared field by field instead — a
 * source building its items fresh every render builds that object fresh too,
 * so comparing it by identity would report a change that isn't one. Functions
 * and component types (`icon`, and anything a future field adds) stay on
 * `===`: a genuinely different icon is a genuine change, and nothing here can
 * tell two closures apart anyway.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameValue(value, b[index]))
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      if (!sameValue(a[key], b[key])) return false
    }
    return true
  }

  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Whether two lists of items say the same thing — same items, same order, same
 * field values — regardless of whether they are the same objects.
 *
 * Compares the *union* of both sides' keys, not one side's, so a field
 * appearing or disappearing counts as a change. Exported for its own unit
 * tests; `useStableItems` below is the only caller in the plugin.
 *
 * @internal
 */
export function sameItems(a: InboxItem[], b: InboxItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((item, index) => sameValue(item, b[index]))
}

/**
 * The same `items` array back, by identity, for as long as its *contents* stay
 * the same.
 *
 * A source's `useItems` is a plain React hook, and the natural way to write one
 * — the way this plugin's own README documents — ends in
 * `items: rows.map(toItem)`, which allocates a fresh array of fresh objects on
 * every render. `SourceFeed` splits that array and reports the result upward,
 * where `Inbox` stores it as state; a new identity every render therefore means
 * a report every render, which means a render every render. That is not
 * hypothetical: it took the Structure tool down in a real project with
 * "Maximum update depth exceeded", and this repo's own `Inbox.test.tsx` carries
 * a comment about hitting the identical crash from a test fixture.
 *
 * Asking every integrator to memoize instead would be a contract that is
 * invisible until it is violated, and violating it costs them the whole pane.
 * So the plugin absorbs it here: hold the last array, hand it back while
 * nothing in it actually changed, and only adopt the new one on a real change.
 *
 * @internal
 */
export function useStableItems(items: InboxItem[]): InboxItem[] {
  // State rather than a ref, and adjusted during render rather than in an
  // effect — React's own "adjusting state when props change" pattern. A ref
  // written during render is what this looked like first; it does the same
  // thing, but this repo's lint rules (rightly) refuse to read one there, and
  // an effect would be a render too late: the report effect in `SourceFeed`
  // would already have fired on the unstable array.
  const [stable, setStable] = useState(items)

  if (stable !== items && !sameItems(stable, items)) {
    // Re-renders immediately, before anything commits. Returning `items` for
    // this one render keeps what the caller sees consistent with what was just
    // stored — the very next render reads it back out of `stable`.
    setStable(items)
    return items
  }

  return stable
}
