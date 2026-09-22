# Plan 069: Stop the validation card saying "all clear" when it simply failed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/documentValidation.ts src/inbox/sources/documentValidation.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — strictly additive error handling.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`documentValidation` prefetches which referenced documents exist, so that
reference-validation rules can be evaluated. That prefetch is an `await` with
no `try`/`catch`, inside an async function launched as `void run()` with no
`.catch`.

If it rejects, `setResults` is never called. `results` stays as it was — empty
on a cold pane — so the source emits **zero rows** while `loading` is already
`false` and `error` is `undefined`. The card renders a confident "no
validation problems" state while drafts really are failing validation.

For an inbox, that is the worst available failure mode: it looks calm exactly
when it is wrong. The rejection surfaces only as an unhandled promise rejection
in the console, and nothing retries until the `drafts` array identity changes.

## Current state

`src/inbox/sources/documentValidation.ts:270-298`:

```ts
async function run(): Promise<void> {
  const existingIds =
    referenceIds.size > 0
      ? new Set(
          await client.fetch<string[]>('*[_id in $ids]._id', {
            ids: Array.from(referenceIds),
          }),
        )
      : new Set<string>()

  const validated = await mapWithConcurrency(drafts, 5, async (draft) => {
    const result = await withTimeout(
      validateDocument({
        document: draft,
        schema,
        client,
        currentUser: currentUser ?? undefined,
        getDocumentExists: ({id}) => Promise.resolve(existingIds.has(id)),
      }),
      TIMEOUT_MS,
      {status: 'notEvaluated' as const, markers: []},
    )
    return [String(draft._id), result] as const
  })

  if (!cancelled) setResults(new Map(validated))
}

void run()
```

Two unprotected awaits: the `client.fetch` at `:274`, and
`mapWithConcurrency` at `:280` (whose inner `validateDocument` is already
protected by `withTimeout`, but `mapWithConcurrency` itself rejects as soon as
any mapper rejects — see its doc comment).

**The posture already in this file**, which the fix should match —
`documentValidation.ts:47-50` treats `notEvaluated` as "unproven, never a
confirmed pass". A failed existence prefetch is exactly that situation: we do
not know whether references resolve, so the honest answer is "could not
evaluate", not "no problems".

**Repo conventions that apply here**:
- Error logging: `console.error('[sanity-plugin-structure-inbox] <message>', error)`.
- `cancelled` is the effect's own teardown flag; every `setResults` must stay behind it.
- Test pattern for this file: `src/inbox/sources/documentValidation.test.ts` uses a stub client. Follow it.

## Commands you will need

| Purpose   | Command                                                        | Expected on success |
|-----------|----------------------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                                            | exit 0, no output   |
| Lint      | `npm run lint`                                                  | exit 0, no output   |
| This suite | `npx vitest run src/inbox/sources/documentValidation.test.ts`  | all pass            |
| Full tests | `npm test`                                                     | all pass            |

## Scope

**In scope:**
- `src/inbox/sources/documentValidation.ts`
- `src/inbox/sources/documentValidation.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `mapWithConcurrency` in this file — plan 077 removes the duplicate. Do not delete or move it here; the two plans would conflict.
- The `withTimeout` wrapper and `TIMEOUT_MS`.
- The outer `catchError` on the drafts observable (`:382`) — plan 063 is the one that changes error semantics there.

## Git workflow

- Branch: `advisor/069-validation-error-state`
- Conventional Commits: `fix:`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Decide what a failed prefetch means, and make it visible

Wrap the prefetch so a failure degrades to "references unproven" rather than
taking the whole run down:

```ts
async function run(): Promise<void> {
  let existingIds: Set<string>
  try {
    existingIds =
      referenceIds.size > 0
        ? new Set(await client.fetch<string[]>('*[_id in $ids]._id', {ids: Array.from(referenceIds)}))
        : new Set<string>()
  } catch (error: unknown) {
    // An empty set means every reference reads as "does not exist", which
    // would invent validation errors. An unproven set is the honest state,
    // and it is the same posture `notEvaluated` already encodes at :47-50 —
    // so tell `getDocumentExists` we cannot answer rather than answering
    // wrongly, and let the rows we *can* evaluate still render.
    console.error('[sanity-plugin-structure-inbox] could not prefetch reference existence', error)
    existingIds = null as unknown as Set<string> // see Step 2 — replace with an explicit sentinel
  }
  ...
```

Do **not** ship that cast. Step 2 replaces it with a real sentinel; it is
written here only to make the shape of the problem visible.

Decide between two honest options and say which you chose:

- **(a) Unproven**: pass `getDocumentExists: undefined` (or whatever
  `validateDocument` accepts to mean "cannot determine"), so reference rules
  are skipped while every other rule still evaluates. Check
  `@sanity/validation`'s typings for whether the option is optional before
  committing to this.
- **(b) Whole-run error**: set an error result so the card shows a failure
  instead of rows.

(a) is preferable — it keeps the non-reference validation working, which is
most of it. Use (b) only if (a) turns out not to be expressible.

### Step 2: Make the sentinel explicit

Replace the cast with a typed representation of "unknown", e.g.:

```ts
const existingIds: Set<string> | null = ...
...
getDocumentExists: existingIds ? ({id}) => Promise.resolve(existingIds.has(id)) : undefined,
```

If `getDocumentExists` is not optional in the installed `@sanity/validation`
typings, that rules out option (a) — say so and use (b).

**Verify**: `npm run typecheck` → exit 0, and `grep -n "as unknown as" src/inbox/sources/documentValidation.ts` returns no new matches.

### Step 3: Catch the whole run, and never leave a confident empty state

```ts
void run().catch((error: unknown) => {
  console.error('[sanity-plugin-structure-inbox] validation run failed', error)
  // Not an empty Map: an empty result renders as "no validation problems",
  // which is a confident claim we have not earned. Surface the failure.
  if (!cancelled) setError(error instanceof Error ? error : new Error(String(error)))
})
```

You will need to check how this source represents an error downstream — read
how `:382`'s `catchError` shapes `DraftsFetch` and follow the same shape rather
than inventing a second error channel. If the only available channel is that
observable's `error` field, thread it through the same way.

**Verify**: `npx vitest run src/inbox/sources/documentValidation.test.ts` → all pass.

### Step 4: Confirm `mapWithConcurrency`'s rejection is covered

`mapWithConcurrency` rejects as soon as any mapper rejects. `validateDocument`
is wrapped in `withTimeout`, so the common case is covered — but confirm by
reading `withTimeout` that it cannot itself reject (e.g. on a thrown
synchronous error inside `validateDocument`). If it can, Step 3's `.catch` is
what handles it, which is fine; say so explicitly in your report.

**Verify**: state the answer in your report.

## Test plan

New tests in `src/inbox/sources/documentValidation.test.ts`, using the file's
existing stub-client pattern.

1. **The bug this plan fixes**: the existence prefetch rejects, and the source
   does **not** report zero rows with no error. Assert whichever outcome Step 1
   chose: either rows from non-reference rules still appear (option a), or an
   error is surfaced (option b). Explicitly assert that the result is not
   `{items: [], error: undefined}` — that combination is the bug.
2. A rejecting prefetch logs via `console.error` with the
   `[sanity-plugin-structure-inbox]` prefix.
3. `mapWithConcurrency` rejecting (one draft's validation throws
   non-timeout-ably) is caught and surfaced rather than unhandled.
4. The happy path is unchanged — an existing test should already cover this;
   confirm it still passes rather than adding a duplicate.

**Verify**: `npm test` → all pass, with 3 new tests.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 3 new tests
- [ ] `grep -n "void run()" src/inbox/sources/documentValidation.ts` shows a `.catch` attached
- [ ] No `as unknown as` cast was introduced
- [ ] Your report states which option (a or b) was chosen and why, and whether `withTimeout` can reject
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `getDocumentExists` is required by `@sanity/validation`'s typings **and**
  there is no documented way to express "cannot determine". Then option (a) is
  unavailable and (b) changes the user-visible behaviour more than this plan
  assumes — worth confirming before shipping.
- Passing an empty `Set` turns out to be what the library already treats as
  "unknown" (rather than "none exist"). Then the current code may be less
  wrong than described — verify against the library's behaviour and report,
  because it changes this plan's premise.
- Surfacing the error requires a new error channel through `useItems`' result
  shape. Report the design question instead of inventing one.

## Maintenance notes

- The rule this establishes: **an empty result and a failed result must never
  render identically.** This source had the shape where they did. Worth
  checking the other sources for the same pattern — plan 063 covers the
  observable-level version of it.
- A reviewer should scrutinise that an empty `Set` is not used to mean
  "unknown", since that silently inverts every reference rule's verdict.
- Deferred out of this plan: retrying a failed prefetch. Nothing retries today
  and this plan does not add it; the refreshable-sources work (Direction A in
  `plans/README.md`) is where that belongs.
