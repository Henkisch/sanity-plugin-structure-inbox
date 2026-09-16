# Plan 035: `onlyMine` filters after the query's own limit, so "your drafts" can read as empty when it isn't

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/inbox/sources/unpublishedDrafts.ts src/inbox/sources/authoredBy.ts`
> If either changed since this plan was written, re-read both and compare
> against the excerpts below before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (more requests per refresh, and a raw fetch limit that
  needs a sane ceiling — see Maintenance notes)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`unpublishedDrafts({onlyMine: true})` is supposed to show "your drafts" —
but the query slices to `limit` (default 10) **dataset-wide, newest
first**, and only *then* filters that already-capped set down to the
current user's own. If the newest `limit` drafts across the whole dataset
happen to belong to other editors, the current user's own older-but-real
unpublished drafts are never even fetched, so they never appear — the pane
reads as "all clear" when it's actually just under-fetched. This is
silent and indistinguishable from a genuinely empty state, which is the
worst kind of bug for a "things waiting on you" pane to have.

## Current state

- `src/inbox/sources/unpublishedDrafts.ts:67-74` — the query, unconditionally
  capped at `$limit` before any authorship filter ever runs:
  ```ts
  const QUERY = `*[
    _id in path("drafts.**") &&
    ($types == null || _type in $types) &&
    _updatedAt < $before
  ] | order(_updatedAt desc)[0...$limit]{
    _id, _type, _updatedAt,
    "title": coalesce(title, name, label, _id)
  }`
  ```
- `src/inbox/sources/unpublishedDrafts.ts:132-183` (`useDraftFetch`, shared
  by both `useOpenCount` and `useItems` — fixing this one function fixes
  both call sites):
  ```ts
  function useDraftFetch(
    client: SanityClient,
    schema: ReturnType<typeof useSchema>,
    userId: string | undefined,
  ): InboxSourceResult {
    const result$ = useMemo(() => {
      const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
      const params = {before, limit, types: types ?? null}

      const toItem = (row: DraftRow): InboxItem => ({ /* ... */ })

      const fetch$ = client.observable.fetch<DraftRow[]>(QUERY, params).pipe(
        switchMap((rows) => {
          // Without a user there is nobody to filter by, so listing
          // everything beats listing nothing.
          if (!onlyMine || !userId || rows.length === 0) return of(rows)

          return from(
            filterAuthoredBy(
              client,
              rows.map((row) => row._id),
              userId,
            ),
          ).pipe(map((mine) => rows.filter((row) => mine.has(row._id))))
        }),
      )

      return liveQuery$(client, QUERY, params, fetch$).pipe(
        map((rows): InboxSourceResult => ({items: rows.map(toItem)})),
        startWith<InboxSourceResult>({items: [], loading: true}),
        catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
      )
    }, [client, schema, userId])

    return useObservable(result$, {items: [], loading: true})
  }
  ```
  `params` (with its fixed `limit`) is passed to **both** the initial fetch
  (line 159) and `liveQuery$`'s own re-run query (line 175) — both need the
  same fix, they share one `params` object today.
- `src/inbox/sources/authoredBy.ts:1-56` (`filterAuthoredBy`, read in full)
  — its own doc comment states the real constraint plainly: "this never
  scans the dataset, it only asks 'of these ten, which are mine'." It's a
  batched transaction-history lookup over a list of ids GROQ has *already*
  narrowed — there is no dataset-wide "documents I authored" query to fall
  back on instead. This means the only lever available is *how many*
  candidate ids get handed to it, not a smarter query.
- `useOpenCount` (`unpublishedDrafts.ts:192-202`) calls the same
  `useDraftFetch` — confirmed it has no separate query of its own, so this
  plan's fix to `useDraftFetch` covers both the open-count badge and the
  actual item list without a second change.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/sources/unpublishedDrafts.ts` (`useDraftFetch`'s query params)
- `src/inbox/sources/unpublishedDrafts.test.ts` (new test case)
- `README.md` (one sentence, if the `onlyMine` option's own docs currently
  imply an exact-`limit` guarantee that no longer holds the same way —
  check first; likely no change needed)

**Out of scope**:
- `src/inbox/sources/authoredBy.ts` — `filterAuthoredBy` itself is correct
  for what it promises ("of these, which are mine"); this plan only changes
  how many candidates it's given, never its own logic.
- Any other source — `onlyMine`/authorship filtering exists only on
  `unpublishedDrafts` today (confirmed: `grep -rln "filterAuthoredBy"
  src/inbox/sources/*.ts` returns only this one file).

## Git workflow

- Commits land directly on `main`. Message style: `fix: over-fetch before
  filtering onlyMine drafts, so a real match isn't missed`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Over-fetch when `onlyMine` is set, then slice to `limit` after filtering

Add a constant near the top of the file:

```ts
/**
 * How many extra candidates to pull before filtering to `onlyMine`, since
 * `filterAuthoredBy` can only sift a batch GROQ already narrowed — it has
 * no way to ask the dataset directly for "documents I authored." A fixed
 * multiplier, not a loop: bounded and predictable, at the cost of still
 * being able to under-report in an extreme case (see this file's own
 * Maintenance notes).
 */
const ONLY_MINE_OVERFETCH_MULTIPLIER = 5
```

In `useDraftFetch`, change the raw fetch limit to over-fetch only when
`onlyMine` is actually set (no reason to change behavior for the common
`onlyMine: false` case at all):

```ts
const rawLimit = onlyMine ? limit * ONLY_MINE_OVERFETCH_MULTIPLIER : limit
const params = {before, limit: rawLimit, types: types ?? null}
```

Then, after `filterAuthoredBy` narrows `rows` to the user's own, slice the
*filtered* result back down to the real `limit` — the query's own
`[0...$limit]` now caps at `rawLimit`, not the final page size, so this
slice is what actually enforces the option's contract:

```ts
).pipe(map((mine) => rows.filter((row) => mine.has(row._id)).slice(0, limit))),
```

(The `!onlyMine` branch already returns `rows` unsliced — leave it as-is,
since in that branch `rawLimit === limit` and the query already capped it
correctly.)

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Add a regression test

In `src/inbox/sources/unpublishedDrafts.test.ts` (check its current
top-of-file mocking setup first — it likely already stubs
`client.observable.fetch`/`filterAuthoredBy` for existing `onlyMine`
tests; follow that same pattern), add a case where:
- The raw (unfiltered) fetch returns more than `limit` rows, and the
  current user authored one that would have fallen *outside* the first
  `limit` of them by recency, but *within* `limit *
  ONLY_MINE_OVERFETCH_MULTIPLIER`.
- Assert the user's own draft **is** present in the final `items` list —
  this is the exact scenario that was silently broken before this plan.
- Assert the final list is still capped at `limit` even when more than
  `limit` of the over-fetched rows belong to the user (the `.slice(0,
  limit)` from Step 1).

**Verify**: `npm test -- unpublishedDrafts` → the new test passes.

### Step 3: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New case(s) in `src/inbox/sources/unpublishedDrafts.test.ts` per Step 2:
  a real match outside the naive `limit` window is still found, and the
  final result is still capped at `limit`.
- Verification: `npm test` → all pass, including the new case(s).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; the new Step 2 test(s) exist and pass
- [ ] `npm run build` exits 0
- [ ] The `onlyMine: false` path's own query behavior is unchanged (no
      over-fetch when there's no filter to apply)
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 035 updated

## STOP conditions

- `filterAuthoredBy`'s own transaction-history endpoint has an undocumented
  practical limit on how many ids it can be asked about in one request
  (the ids are joined into a URL path, `documentIds.join(',')` —
  `authoredBy.ts:28`), and `limit * ONLY_MINE_OVERFETCH_MULTIPLIER` at the
  configured `limit` could plausibly exceed a reasonable URL length for an
  unusually large `limit` option. If you find evidence of a real practical
  cap (e.g. from Sanity's own docs or an actual request failure during
  testing), STOP and report rather than picking a multiplier that could
  silently break for large `limit` configurations.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

This is a heuristic, not a guarantee: if the user's own drafts are rarer
than 1-in-`ONLY_MINE_OVERFETCH_MULTIPLIER` among all recent drafts
dataset-wide, this can still under-report. A fully correct fix would need
either a real "documents authored by X" GROQ-level query (doesn't exist
today — see `authoredBy.ts`'s own doc comment) or a bounded retry loop that
keeps widening the raw fetch until `limit` matches or a hard ceiling is
hit. This plan intentionally picks the simpler, bounded, fixed-multiplier
version — it turns a bug that was *always* wrong in this scenario into one
that is wrong only in a much narrower, genuinely rare case. If a real
integrator reports this still under-counting, revisit with a widening
retry loop instead of just raising the multiplier further.
