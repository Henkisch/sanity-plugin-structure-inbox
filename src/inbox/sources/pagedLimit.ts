import {useCallback, useState} from 'react'

/**
 * How many rows one "Show more" click adds to the whole list, split across
 * the sources that have more. Baymard's product-list testing found pages
 * much smaller than 50 slowed people down with repeated loading, and put
 * the desktop sweet spot at 50–150. The low end is used here, because every
 * loaded row is also a rendered row (see `MAX_LOADED_ROWS`).
 */
export const PAGE_SIZE = 50

/**
 * At or below this many remaining, the button offers all of them at once
 * ("Show all 44"). NN/g's guidance for load-more lists is to make the end
 * of the set visible and reachable; a tail this short isn't worth another
 * click.
 */
export const SHOW_ALL_THRESHOLD = 100

/**
 * The most open rows the whole list may hold, across every source. Rows are
 * not memoized, so every re-render of the list (a live refetch, a
 * selection) re-renders every loaded row, and this is the bound on that
 * cost. Past it, the footer stops offering more and points at the type
 * filter.
 *
 * Measured in jsdom (2026-09-28): a list re-render costs about 1.3 ms per
 * row there, 45 ms at 20 rows and 387 ms at 300. A browser is faster than
 * jsdom, but not enough to make 300 comfortable on every selection click.
 * 200 is close to what a default config can already load on first open
 * (`assetIssues` alone: 20 per check, per image field), so "Show more"
 * can't push the list far past today's worst case. Plan 095 (memoized
 * rows) is what would let this rise.
 */
export const MAX_LOADED_ROWS = 200

/**
 * Splits `count` across buckets in proportion to how much each has left
 * (largest-remainder rounding), never giving a bucket more than its
 * capacity. The result sums to `min(count, total capacity)`.
 *
 * Proportional rather than first-come: the list is merged and time-sorted,
 * so a page drawn from one source at a time would load one kind of row
 * after another while the others stayed hidden.
 */
export function allocate(count: number, capacities: readonly number[]): number[] {
  const caps = capacities.map((cap) => Math.max(0, Math.floor(cap)))
  const total = caps.reduce((sum, cap) => sum + cap, 0)
  const wanted = Math.max(0, Math.floor(count))
  if (wanted >= total) return caps
  if (wanted === 0) return caps.map(() => 0)

  const exact = caps.map((cap) => (cap / total) * wanted)
  const shares = exact.map(Math.floor)
  let left = wanted - shares.reduce((sum, share) => sum + share, 0)
  const byRemainder = exact
    .map((value, index) => ({index, remainder: value - Math.floor(value)}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const {index} of byRemainder) {
    if (left === 0) break
    if (shares[index] < caps[index]) {
      shares[index] += 1
      left -= 1
    }
  }
  return shares
}

/**
 * A source's `limit`, raised by however many rows each `loadMore(count)`
 * asks for. The per-source half of the list's "Show more" footer.
 *
 * Session state on purpose: it lives as long as the pane does, and a fresh
 * pane starts from the configured `limit` again. `loadMore` is referentially
 * stable, and `undefined` once the ceiling is reached, so the footer stops
 * offering a click that could no longer load anything.
 *
 * @internal
 */
export function usePagedLimit(base: number): {limit: number; loadMore?: (count: number) => void} {
  const [extra, setExtra] = useState(0)
  const ceiling = Math.max(base, MAX_LOADED_ROWS)
  const limit = Math.min(base + extra, ceiling)
  const loadMore = useCallback(
    (count: number) => setExtra((current) => current + Math.max(0, Math.floor(count))),
    [],
  )
  return {limit, loadMore: limit < ceiling ? loadMore : undefined}
}
