import type {SanityClient} from '@sanity/client'
import type {Observable} from 'rxjs'
import {debounceTime, startWith, switchMap} from 'rxjs/operators'

/**
 * Turns a one-shot query into one that re-runs itself whenever a matching
 * document changes.
 *
 * `client.listen` is the query-scoped realtime listener — not the newer Live
 * Content API, which invalidates by sync tag across a whole dataset and is
 * built for cached, published content rather than an arbitrary GROQ filter.
 * This only tells us *that* something matching changed, never *what* — so
 * every event triggers a plain refetch of `fetch$` rather than an attempt to
 * patch the existing list in place. `debounceTime` coalesces a burst of
 * mutations (autosave, a multi-field paste) into one refetch instead of one
 * per keystroke.
 */
export function liveQuery$<T>(
  client: SanityClient,
  query: string,
  params: Record<string, unknown>,
  fetch$: Observable<T>,
): Observable<T> {
  return client.listen(query, params).pipe(
    debounceTime(500),
    startWith(null),
    switchMap(() => fetch$),
  )
}
