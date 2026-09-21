import type {SanityClient} from '@sanity/client'
import {defer, type Observable, of} from 'rxjs'
import {catchError, debounceTime, startWith, switchMap} from 'rxjs/operators'

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
 *
 * `enableResume: true` plus listening for `welcome`/`reset` (not just
 * `mutation`) is the fix for a real, reported bug: without it, a dropped SSE
 * connection (laptop sleep, a network blip, a backgrounded tab) reconnects
 * silently on its own, but any mutation that happened during the gap is gone
 * — the client has no way to know it missed something, so nothing here ever
 * refetches, and the list just sits stale until a full reload remounts it.
 * `enableResume` asks the backend to resume from where the connection left
 * off; when it can (a `welcomeback` event, not subscribed to here — it means
 * nothing was missed, so no forced refetch is needed), and `welcome`/`reset`
 * when it can't (per `@sanity/client`'s own docs: "you should also add
 * `reset` to the events array and handle the case where the backend is
 * unable to resume" — treating either the same as a `mutation`, a plain
 * refetch, is that handling).
 */
export function liveQuery$<T>(
  client: SanityClient,
  query: string,
  params: Record<string, unknown>,
  fetch$: Observable<T>,
  /**
   * What to emit when one refetch fails. The live subscription survives it:
   * without this, an error from `fetch$` propagates out of the `switchMap`
   * and *terminates* the observable, so a single transient failure means the
   * source never updates again for the life of the pane — which for
   * `assignmentStore` meant every row reading "Unassigned" forever, with no
   * error surfaced anywhere.
   *
   * `needsAttention.ts` solved the same problem locally by putting its
   * `catchError` inside a `defer`; this generalises that. `defer` here is
   * load-bearing, not decorative: `fetch$` is constructed once by the
   * caller, so without re-deferring it, a cold observable that already
   * errored once can replay that same cached error on every later
   * resubscription instead of genuinely retrying — recovery would then work
   * only once instead of every time.
   *
   * Left `undefined`, a failed refetch still propagates out of this
   * observable exactly as before, so the seven existing call sites keep
   * compiling and can be migrated one at a time.
   */
  onFetchError?: (error: Error) => T,
): Observable<T> {
  return client.listen(query, params, {enableResume: true, events: ['mutation', 'welcome', 'reset']}).pipe(
    debounceTime(500),
    startWith(null),
    switchMap(() =>
      onFetchError
        ? defer(() => fetch$).pipe(catchError((error: Error) => of(onFetchError(error))))
        : fetch$,
    ),
  )
}
