import {useCallback, useState} from 'react'

/**
 * The most rows one capped query may ask for, however many times "Show more"
 * is clicked. `assetIssues` runs one capped query per check and per image
 * field, so an unbounded limit would multiply straight into a heavy fetch.
 * Past this, the footer still says how many are left; fixing some is how the
 * rest come into view.
 */
export const MAX_PAGED_LIMIT = 200

/**
 * A source's `limit`, raised by one page (the configured `limit` itself) per
 * `loadMore()` — the per-source half of the list's "Show more" footer.
 *
 * Session state on purpose: it lives as long as the pane does, and a fresh
 * pane starts from the configured `limit` again. `loadMore` is referentially
 * stable, and `undefined` once the ceiling is reached, so the footer stops
 * offering a click that could no longer load anything.
 *
 * @internal
 */
export function usePagedLimit(base: number): {limit: number; loadMore?: () => void} {
  const [pages, setPages] = useState(1)
  const ceiling = Math.max(base, MAX_PAGED_LIMIT)
  const limit = Math.min(base * pages, ceiling)
  const loadMore = useCallback(() => setPages((current) => current + 1), [])
  return {limit, loadMore: limit < ceiling ? loadMore : undefined}
}
