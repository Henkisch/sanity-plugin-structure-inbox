# Plan 080: Degrade `onlyMine` instead of emptying the Drafts card

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/unpublishedDrafts.ts src/inbox/sources/unpublishedDrafts.test.ts src/inbox/sources/authoredBy.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — the fallback shows more rows than requested, capped.
- **Depends on**: plan 063 (which changes the same file's error semantics). If both run, do 063 first.
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`unpublishedDrafts` states its own posture at `:198-199`: **listing everything
beats listing nothing**. That is why it falls back to the unfiltered list when
there is no current user.

But when the `onlyMine` *enrichment* fails, it does the opposite. There is no
per-call catch around `filterAuthoredBy`, and `authoredBy.ts:15-33` throws on
any `client.request` failure (only per-line `JSON.parse` is tolerated). The
rejection lands in the outer `catchError` and becomes an error result — zero
rows, error card. And per plan 063, it also terminates the live stream.

The history endpoint is exactly the surface that varies by plan and retention,
and `onlyMine` batches up to `limit * 5` ids into the URL path
(`authoredBy.ts:28`). A 4xx or 5xx there should cost the *filter*, not the
card.

## Current state

`src/inbox/sources/unpublishedDrafts.ts:195-209` — the `switchMap` calling
`from(filterAuthoredBy(client, ids, userId))` with no per-call catch.

`src/inbox/sources/unpublishedDrafts.ts:198-199` — the stated posture, in the
no-user branch.

`src/inbox/sources/authoredBy.ts:15-33` — throws on request failure;
`:48-52` tolerates only per-line `JSON.parse` errors.

`src/inbox/sources/unpublishedDrafts.ts:214` — the outer `catchError` that
turns it into an error result.

Second site, same shape: `fetchDocumentAuthors` in `suggestAssignee`
(`unpublishedDrafts.ts:353-358`).

**Conventions**: `warnOnce` (`src/warnOnce.ts`) is how this repo surfaces a
degradation to the integrator without spamming. Error logs use the
`[sanity-plugin-structure-inbox]` prefix.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| This suite | `npx vitest run src/inbox/sources/unpublishedDrafts.test.ts` | all pass |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/inbox/sources/unpublishedDrafts.ts`,
`src/inbox/sources/unpublishedDrafts.test.ts`

**Out of scope:**
- `src/inbox/sources/authoredBy.ts` — it is correct to throw; the caller decides how to degrade. Do not make it swallow errors, or `suggestAssignee` loses its own error signal.
- The outer `catchError` (plan 063).
- Percent-encoding document ids in the history URL — recorded as considered-and-rejected in `plans/README.md`.

## Git workflow

- Branch: `advisor/080-onlymine-degrade`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Catch the enrichment, keep the rows

```ts
from(filterAuthoredBy(client, ids, userId)).pipe(
  catchError((error: unknown) => {
    // The source's own posture, two branches up: listing everything beats
    // listing nothing. A failed history read should cost the `onlyMine`
    // filter, not the whole card — the history endpoint varies by plan and
    // retention, and this batches up to `limit * 5` ids into one URL.
    warnOnce(
      'unpublishedDrafts could not read document history, so `onlyMine` is not being applied — ' +
        'showing everyone\'s drafts instead of none.',
    )
    console.error('[sanity-plugin-structure-inbox] onlyMine filter failed', error)
    return of(rows.slice(0, limit))
  }),
)
```

The `.slice(0, limit)` matters: the query over-fetches (`limit * 5`) precisely
because the filter is expected to remove rows. Without the cap, a failure shows
five times the requested number.

`warnOnce` rather than `console.warn` so a repeated failure does not spam —
and so the integrator can actually see why the filter stopped working.

**Verify**: `npx vitest run src/inbox/sources/unpublishedDrafts.test.ts` → all pass.

### Step 2: Do the same for `suggestAssignee`

`fetchDocumentAuthors` at `:353-358` has the same one-way failure. Here the
honest degradation is **no suggestion** rather than a wrong one:

```ts
// No suggestion beats a wrong one, and beats an error the editor cannot act
// on: `suggestAssignee` is an optional convenience.
```

Return `undefined`/`null` (match the function's own contract — read it) and log
once.

**Verify**: `npm run typecheck` → exit 0.

## Test plan

In `src/inbox/sources/unpublishedDrafts.test.ts`:

1. **The regression**: `onlyMine: true`, a stub whose history request rejects →
   the result has rows (not `[]`) and **no** `error`. Before this plan it is
   `{items: [], error}`.
2. The fallback is capped at `limit`, not the over-fetched `limit * 5`.
3. A `warnOnce` message is emitted (spy on `console.warn`; call
   `resetWarnings()` from `src/warnOnce.ts` in `beforeEach`, as
   `src/structure/wrapStructure.test.ts:11` does).
4. The happy path still filters (existing behaviour; confirm an existing test
   covers it rather than duplicating).
5. `suggestAssignee` with a rejecting authors fetch → resolves with no
   suggestion, does not reject.

**Verify**: `npm test` → all pass, ~4 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Test 1 was confirmed to fail before the change
- [ ] The fallback slices to `limit` (test 2 asserts the count)
- [ ] `grep -c "warnOnce" src/inbox/sources/unpublishedDrafts.ts` → at least 1
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- The over-fetch multiplier is not `limit * 5` at HEAD. Read the real value and
  use it; the cap must match what the query asks for.
- Catching here masks a failure `suggestAssignee` needs to see. The two paths
  share `authoredBy.ts` but degrade differently — keep them separate and report
  if they cannot be.
- Showing everyone's drafts when the editor asked for only theirs is judged
  unacceptable. That is a product call: the alternative is an explicit "could
  not filter" state on the card. Report rather than deciding.

## Maintenance notes

- The invariant this restores: an **enrichment** failing degrades the
  enrichment, never the data. `onlyMine` is a filter on top of a working query.
- A reviewer should check the `limit` cap. Without it the failure mode becomes
  "five times too many rows", which is a different bug.
