# Plan 063: Survive a failed refetch instead of going dark for the rest of the session

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/liveQuery.ts src/inbox/sources/liveQuery.test.ts src/inbox/sources/assignmentStore.ts src/inbox/sources/openTasks.ts src/inbox/sources/unpublishedDrafts.ts src/inbox/sources/documentValidation.ts src/inbox/sources/assetIssues.ts src/inbox/sources/linkCheckerFindings.ts src/inbox/sources/unresolvedComments.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — this changes error semantics across seven sources. A source that used to latch an error card will now recover, so any test asserting the latched state needs updating deliberately rather than deleted.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Every live source in this plugin is built the same way: subscribe to
`client.listen`, and on each event re-run a fetch. The re-run is wired with
`switchMap`, which means **an error from the fetch propagates out of the whole
observable and terminates it**. The consumer's `catchError` then sits on the
*outer* pipe, so it converts that terminal error into one final value — and the
stream is over.

The practical consequence: one transient failure (a 503, a tab that was offline
for a moment, a token that expired on exactly that refetch) and the source is
dead for the rest of the pane's life. No further live updates arrive, ever.
And there is no user-facing retry, because the "Try again" button was
deliberately removed as inert (plan 034).

The worst case is `assignmentStore`, because it degrades **silently**: its
`catchError` returns an empty `Map`, so every row in every assignable source
renders "Unassigned" forever, with no error shown anywhere. An editor cannot
tell the difference between "nobody is assigned" and "the assignment store
died twenty minutes ago".

For an inbox, silently under-reporting is the worst available failure mode: the
pane looks calm precisely when it is broken.

One source already does this correctly, and its comment explains why —
`needsAttention` puts its `catchError` **inside** the inner fetch observable,
so a failure costs one refetch and the live subscription survives. That is the
shape to generalise.

## Current state

**The mechanism** — `src/inbox/sources/liveQuery.ts:32-45`:

```ts
export function liveQuery$<T>(
  client: SanityClient,
  query: string,
  params: Record<string, unknown>,
  fetch$: Observable<T>,
): Observable<T> {
  return client.listen(query, params, {enableResume: true, events: ['mutation', 'welcome', 'reset']}).pipe(
    debounceTime(500),
    startWith(null),
    switchMap(() => fetch$),
  )
}
```

`fetch$` is passed in already-constructed. An error inside it flows through
`switchMap` and out.

**The seven consumers, each with its `catchError` on the outer pipe** (so each
one is terminal today):

- `src/inbox/sources/assignmentStore.ts:118` — `catchError(() => of(new Map<string, string>()))` ← the silent one
- `src/inbox/sources/openTasks.ts:285`
- `src/inbox/sources/unpublishedDrafts.ts:214`
- `src/inbox/sources/documentValidation.ts:382`
- `src/inbox/sources/assetIssues.ts:706`
- `src/inbox/sources/linkCheckerFindings.ts:415`
- `src/inbox/sources/unresolvedComments.ts:258`

For example, `src/inbox/sources/assignmentStore.ts:112-120`:

```ts
const byTarget$ = useMemo(() => {
  const params = {docType}
  const fetch$ = client.observable.fetch<AssignmentRow[]>(query, params)
  return liveQuery$(client, query, params, fetch$).pipe(
    map((rows) => new Map(rows.map((row) => [row.targetId, row.assignedTo]))),
    catchError(() => of(new Map<string, string>())),
  )
}, [client, query, docType])
```

**The in-repo contrast, which is correct** —
`src/inbox/sources/needsAttention.ts:91-106`:

```ts
const readCounts$ = defer(() =>
  from(client.fetch<{name: string; count: number}[]>(query, {names: releaseIds})).pipe(
    map((rows) => new Map(rows.map((row) => [row.name, row.count]))),
    // Every sibling source's own fetch pipeline degrades to an empty
    // result on error rather than propagating — this was the one
    // exception, and an unhandled observable error here doesn't just
    // lose the counts: `useObservable` throws it during render, which
    // takes down the whole "Needs attention" card [...]
    catchError(() => of(new Map<string, number>())),
  ),
)
```

Note it is wrapped in `defer` so the `catchError` is re-created per
subscription, which is what makes recovery repeatable rather than one-shot.

**Repo conventions that apply here**:
- RxJS operators are imported from `'rxjs/operators'`, sources from `'rxjs'`.
- `useObservable` from `react-rx` consumes these; an unhandled error throws during render (see the `needsAttention` comment above) — so a source must never let one escape.
- `liveQuery.test.ts` is the existing test pattern for this module, and it already uses fake timers (`liveQuery.test.ts:78`). Follow that rather than real-timer waits.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                              | exit 0, no output   |
| Lint      | `npm run lint`                                   | exit 0, no output   |
| This module | `npx vitest run src/inbox/sources/liveQuery.test.ts` | all pass |
| All sources | `npx vitest run src/inbox/sources/`            | all pass            |
| Full tests | `npm test`                                      | all pass            |
| Build     | `npm run build`                                  | `[success]`         |

## Scope

**In scope:**
- `src/inbox/sources/liveQuery.ts` — the fix belongs here, once, rather than seven times
- `src/inbox/sources/liveQuery.test.ts` — new tests
- Each of the seven consumer files, **only** if Step 2 shows a call-site change is needed

**Out of scope** (do NOT touch, even though they look related):
- `src/inbox/sources/needsAttention.ts`'s inner `catchError` — it is already correct and is the model for this plan. Leave it.
- Adding a user-facing retry button. Plan 034 removed the inert one on purpose; a real retry needs the refreshable-sources mechanism recorded as Direction A in `plans/README.md`. Not this plan.
- The `debounceTime(500)` and `enableResume`/`events` configuration — unrelated and deliberately chosen.

## Git workflow

- Branch: `advisor/063-livequery-recovery`
- Conventional Commits. This is a `fix:`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the refetch failure non-terminal inside `liveQuery$`

The fix is to keep a failed fetch from escaping the `switchMap`, so the
`listen` subscription survives it.

Change `liveQuery$` so the caller can supply how a failed refetch should be
represented, while the stream stays alive. Target shape:

```ts
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
   * `catchError` inside a `defer`; this generalises that.
   */
  onFetchError?: (error: Error) => T,
): Observable<T> {
  return client.listen(...).pipe(
    debounceTime(500),
    startWith(null),
    switchMap(() =>
      onFetchError
        ? defer(() => fetch$).pipe(catchError((error: Error) => of(onFetchError(error))))
        : fetch$,
    ),
  )
}
```

Two things are load-bearing and easy to get wrong:

1. **`defer`**. `fetch$` is constructed once by the caller. Wrapping it in
   `defer` is what makes each refetch a fresh subscription, so recovery works
   more than once. Without `defer`, a cold observable may replay a cached
   error.
2. **The parameter stays optional**, so the seven consumers compile unchanged
   and can be migrated one at a time in Step 2. Do not make it required.

Also keep a terminal-error path for `listen` itself: if the listener channel
errors (as opposed to a fetch), the outer `catchError` in each consumer still
handles it. Do not swallow that here.

**Verify**: `npm run typecheck` → exit 0. `npx vitest run src/inbox/sources/`
→ all pass, unchanged (no consumer has been migrated yet).

### Step 2: Migrate the seven consumers, starting with the silent one

For each consumer, pass `onFetchError` returning the same value its outer
`catchError` returns today, and **keep** the outer `catchError` for the
`listen`-channel case.

Do `assignmentStore.ts` first and separately — it is the one that fails
silently, so it is the one most worth getting right and reviewing on its own:

```ts
return liveQuery$(client, query, params, fetch$, () => new Map<string, string>()).pipe(
  map((rows) => (rows instanceof Map ? rows : new Map(rows.map(...)))),
  catchError(() => of(new Map<string, string>())),
)
```

Careful: in `assignmentStore` the `map` currently runs *after* `liveQuery$`, so
an `onFetchError` that returns a `Map` would be fed into a `map` expecting
rows. Restructure so the error value and the success value have the same shape
by the time they reach `map` — the cleanest way is to move the `map` into
`fetch$` itself and have `onFetchError` return the already-mapped empty `Map`.
State in your report how you resolved this for each consumer, because the six
others have the same shape question.

Then the remaining six, each mirroring its existing outer `catchError` value:

- `openTasks.ts:285` → `{items: [], error, rowAssignees: new Map()}`
- `unpublishedDrafts.ts:214` → `{items: [], error}`
- `documentValidation.ts:382` → `{drafts: [], error}`
- `assetIssues.ts:706` → `{oversized: [], unused: [], missingAlt: [], poorAlt: [], error}`
- `linkCheckerFindings.ts:415` → (read the current value; mirror it)
- `unresolvedComments.ts:258` → `{rows: [], error}`

Note that for these six, the source now shows an error card **and keeps
listening**, so the card clears itself on the next successful refetch. That is
the intended improvement.

**Verify**: after each file, `npx vitest run src/inbox/sources/` → all pass.
If a test asserting a latched error state now fails, that is expected — update
it deliberately to assert recovery, and say which test you changed and why.

### Step 3: Confirm no error can reach `useObservable`

`needsAttention.ts:94-103` documents that an unhandled observable error throws
during render and takes the whole card down. After Steps 1–2 every source has
two layers (inner `onFetchError`, outer `catchError`), so nothing should
escape.

**Verify**: `grep -n "useObservable" src/inbox/sources/*.ts` — for each hit,
confirm by reading that its observable has a `catchError` on the outer pipe.
List them in your report with a yes/no each.

## Test plan

New tests in `src/inbox/sources/liveQuery.test.ts`. Use fake timers, as
`liveQuery.test.ts:78` already does — the `debounceTime(500)` makes real-timer
tests slow and flaky.

Cases:

1. **The regression this plan fixes**: a `fetch$` that rejects on its first
   call and succeeds on the second. Push a `listen` event, advance timers, let
   the first fetch fail; assert the `onFetchError` value was emitted. Push a
   second `listen` event, advance timers; assert **the second, successful value
   is also emitted**. Before this plan, the stream would have completed and the
   second value never arrives — that assertion is the whole point of the test.
2. **The stream does not complete on a failed fetch**: subscribe with a
   `complete` spy; after a failed fetch, assert `complete` was not called.
3. **Recovery works more than once**: fail, succeed, fail, succeed. This is the
   test that catches a missing `defer`.
4. **No `onFetchError` supplied**: a failed fetch still propagates (existing
   behaviour preserved for any caller that has not migrated).
5. **A `listen`-channel error still propagates** to the outer pipe, so the
   consumer's own `catchError` remains the handler for that case.

Model the stub shape on the existing tests in this file.

**Verify**: `npm test` → all pass, with 5 new tests in `liveQuery.test.ts`.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 5 new tests in `src/inbox/sources/liveQuery.test.ts`
- [ ] `npm run build` exits 0 with `[success]`
- [ ] All seven consumers pass `onFetchError` (`grep -c "onFetchError" src/inbox/sources/*.ts` shows a hit in each of the seven, plus `liveQuery.ts`)
- [ ] Every outer `catchError` is still present (this plan adds a layer, it does not remove one)
- [ ] Your report lists, per consumer, how the error-value/success-value shape question was resolved
- [ ] Your report lists every `useObservable` site with a yes/no on whether its pipe is guarded
- [ ] Any test changed from asserting a latched error to asserting recovery is named in your report, with the reason
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Reshaping a consumer so the error value and success value agree requires
  restructuring that consumer's fetch pipeline by more than moving a `map`.
  Two or three such cases means this plan's shape is wrong and needs
  rethinking before the remaining sources are touched.
- More than two existing tests need their assertions changed. That suggests the
  latched-error behaviour is depended on somewhere this plan did not anticipate.
- Removing the `defer` makes the tests pass anyway — that means the tests are
  not actually exercising repeat recovery, so tighten the test rather than
  dropping the `defer`.
- You find a `useObservable` whose observable has no outer `catchError`. That
  is a separate live bug (it throws during render); report it rather than
  folding a fix into this plan.

## Maintenance notes

- Any new source must pass `onFetchError`. The optional parameter is what makes
  this plan safely incremental, but it also means a future source can silently
  opt out of recovery. Consider making it required in a later major — noted
  here rather than done now, because it would be a breaking change to
  `liveQuery$`'s signature and that function is not part of the public API
  surface today (confirm that before acting on it).
- A reviewer should scrutinise: the `defer` (its absence is invisible until the
  second failure), and that `assignmentStore`'s empty-`Map` degradation is now
  per-refetch rather than permanent.
- Deferred out of this plan: a user-facing retry, and any change to
  `debounceTime`. Both are recorded in `plans/README.md` (Direction A).
