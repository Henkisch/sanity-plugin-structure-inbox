/**
 * Bounded-concurrency `map`, shared by every caller that fans out over a list
 * of documents — the project survey (`projectDigest.ts`), the selection
 * bar's bulk quick fix (`MergedList.tsx`), and the drafts validation source
 * (`documentValidation.ts`).
 *
 * Extracted rather than duplicated because the reason for the bound is the
 * same in both places and easy to lose: firing one request per item at once is
 * a burst against Sanity's own API rate limits, and a selection of two hundred
 * rows is exactly the case where that stops being theoretical.
 *
 * Note this rejects as soon as any `fn` rejects, like `Promise.all`. A caller
 * that wants per-item outcomes catches inside its own `fn` and returns the
 * failure as a value.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({length: items.length})
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      // eslint-disable-next-line no-await-in-loop -- this loop IS the bounded-concurrency mechanism: each of the `concurrency` workers below claims and awaits one item at a time so at most `concurrency` requests are ever in flight together, deliberately not `Promise.all`-ing every item at once.
      results[index] = await fn(items[index])
    }
  }

  // `concurrency <= 0` (or fractional) would otherwise spawn zero or a
  // fractional count of workers, resolving an array of holes instead of
  // mapping anything — every call site passes a literal `5`, so this is a
  // guard against a future caller, not a live bug.
  const workers = Math.max(1, Math.floor(concurrency))
  await Promise.all(Array.from({length: Math.min(workers, items.length)}, worker))
  return results
}
