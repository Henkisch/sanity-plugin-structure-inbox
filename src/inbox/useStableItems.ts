import {useRef, useState} from 'react'

import {warnOnce} from '../warnOnce'
import {type InboxItem} from './types'

/**
 * How many times in a row a render may adopt a new items array before this
 * hook stops trying and freezes the last one. A genuine data change adopts
 * once and then commits, which resets the counter; only a comparator that can
 * never return true climbs this high.
 */
const MAX_CONSECUTIVE_ADOPTIONS = 5

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

  // Two functions — `icon` is the documented case, and a source that builds
  // its items inline builds a fresh `() => <Foo/>` on every render. There is no
  // way to tell two closures apart, so compare the only stable thing they
  // carry: their name (both `''` for inline arrows, the component's own name
  // when it has one). Treating them as unequal instead is what made a
  // per-render icon freeze the whole source.
  if (typeof a === 'function' && typeof b === 'function') {
    return a.name === b.name
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
export function useStableItems(items: InboxItem[], sourceName = 'a source'): InboxItem[] {
  // State rather than a ref, and adjusted during render rather than in an
  // effect — React's own "adjusting state when props change" pattern. A ref
  // written during render is what this looked like first; it does the same
  // thing, but this repo's lint rules (rightly) refuse to read one there, and
  // an effect would be a render too late: the report effect in `SourceFeed`
  // would already have fired on the unstable array.
  const [stable, setStable] = useState(items)

  // How many times in a row this render has adopted a new array without a
  // commit in between. `sameItems` cannot be made total — a value that is
  // neither a primitive, a plain object nor an array (a function, a `Date`, a
  // `Map`, a class instance) can only be compared by `===`, so an item
  // carrying a freshly-allocated one of those on every render compares
  // unequal *forever*. `icon?: ComponentType` is exactly that shape and is
  // documented public API. Without a bound, this hook's own `setStable` below
  // then runs on every render, which is a render-phase update loop — upstream
  // of `sameReport` and of the error boundary around `SourceFeed`, so neither
  // can contain it. Confirmed by test, not assumed.
  //
  // The counter resets below on the *equal* path — a render where the content
  // did compare the same. That is the honest signal that this source can
  // settle. Resetting on commit instead was tried and is wrong: the loop simply
  // ran to the cap, committed, reset, and ran again, forever.
  const adoptions = useRef(0)

  if (stable !== items && !sameItems(stable, items)) {
    // eslint-disable-next-line refs -- adjusting state when a value changes; see the comment above
    if (adoptions.current >= MAX_CONSECUTIVE_ADOPTIONS) {
      warnOnce(
        `${sourceName} returns items that never compare equal — most likely a value on each item ` +
          `(an \`icon\`, a \`Date\`, a \`Map\`) is allocated fresh on every render. Its rows are now ` +
          `frozen at the last version rather than looping. Memoize the items, or hoist that value.`,
      )
      return stable
    }

    // eslint-disable-next-line refs -- adjusting state when a value changes; see the comment above
    adoptions.current += 1
    // Re-renders immediately, before anything commits. Returning `items` for
    // this one render keeps what the caller sees consistent with what was just
    // stored — the very next render reads it back out of `stable`.
    setStable(items)
    return items
  }

  // Content compared equal, so whatever churn there was has settled. Anything
  // that genuinely alternates gets its full allowance again from here.
  // eslint-disable-next-line refs -- adjusting state when a value changes; see the comment above
  adoptions.current = 0

  return stable
}
