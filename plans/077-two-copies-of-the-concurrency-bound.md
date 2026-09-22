# Plan 077: One `mapWithConcurrency`, and tests on the copy the paid paths actually use

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/concurrency.ts src/inbox/sources/documentValidation.ts src/inbox/sources/documentValidation.test.ts src/inbox/projectDigest.ts src/inbox/MergedList.tsx src/store/useTodos.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — moving tests and deleting a duplicate with identical behaviour.
- **Depends on**: plan 069 also edits `documentValidation.ts`. If both run, do 069 first.
- **Category**: tech-debt + tests
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

There are **two** implementations of `mapWithConcurrency`, with identical
behaviour:

- `src/inbox/concurrency.ts:15` — the shared one, imported by
  `projectDigest.ts` (the AI survey) and `MergedList.tsx` (the bulk quick fix).
  **No test file.**
- `src/inbox/sources/documentValidation.ts:201` — its own private copy, used
  only by itself. **This is the one that is tested**
  (`documentValidation.test.ts:114-147`, "never runs more than `concurrency`
  mappers at once").

So the bound that stands between a 200-row selection and an API rate-limit
burst is verified only on a copy nobody else imports. Deleting or refactoring
`documentValidation`'s copy would silently remove the only coverage.

There is a documentation drift on top of it. `concurrency.ts:6` says:

> Extracted rather than duplicated because the reason for the bound is the
> same in both places and easy to lose

…while the duplicate is still there. And `src/store/useTodos.ts:158` points a
reader at "`mapWithConcurrency` in `projectDigest.ts`" — where it no longer
lives.

## Current state

`src/inbox/concurrency.ts:1-13` — the doc comment, including the "Extracted
rather than duplicated" claim and the documented rejection behaviour:

```
Note this rejects as soon as any `fn` rejects, like `Promise.all`. A caller
that wants per-item outcomes catches inside its own `fn` and returns the
failure as a value.
```

`src/inbox/sources/documentValidation.ts:195-220` — the duplicate, with its own
doc comment ("Exported for its own test") and its own
`eslint-disable no-await-in-loop` comment.

Importers (`grep -rn "mapWithConcurrency" src/ | grep -v test`):
- `src/inbox/projectDigest.ts:5,145`
- `src/inbox/MergedList.tsx:29,532`
- `src/inbox/sources/documentValidation.ts:201,280`
- `src/store/useTodos.ts:158` — a **comment** reference, not an import

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/inbox/concurrency.ts`, `src/inbox/concurrency.test.ts`
(create), `src/inbox/sources/documentValidation.ts` (delete the duplicate and
import the shared one), `src/inbox/sources/documentValidation.test.ts` (move
the tests out), `src/store/useTodos.ts` (fix the stale comment pointer)

**Out of scope:** the behaviour of either implementation, and
`QUICK_FIX_CONCURRENCY` / `SURVEY_CONCURRENCY` values.

## Git workflow

- Branch: `advisor/077-one-concurrency`
- Conventional Commits: `refactor:` or `test:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the two implementations really are equivalent

Read both in full and diff them by eye. They should differ only in identifier
names (`fn` vs `mapper`) and comments.

**Verify**: state in your report that they are behaviourally identical, or
name the difference. If they differ, that changes this plan — STOP.

### Step 2: Move the tests to the shared module

Create `src/inbox/concurrency.test.ts` and move the
`describe('mapWithConcurrency')` block from
`documentValidation.test.ts:114-147` into it, importing from
`../concurrency`.

Add the case the shared module's own doc comment promises but nothing
verifies: **a rejecting `fn` rejects the whole call** (`concurrency.ts:11-13`).

**Verify**: `npx vitest run src/inbox/concurrency.test.ts` → the moved tests
plus the rejection test pass.

### Step 3: Delete the duplicate

In `documentValidation.ts`: remove its local `mapWithConcurrency` and
`import {mapWithConcurrency} from '../concurrency'` instead. Keep the
`no-await-in-loop` reasoning only where the loop actually is (in
`concurrency.ts`); do not leave an orphaned eslint-disable behind.

**Verify**: `npm run typecheck` → exit 0; `npx vitest run src/inbox/sources/documentValidation.test.ts` → all pass;
`grep -c "async function mapWithConcurrency" src/inbox/sources/documentValidation.ts` → 0.

### Step 4: Fix the two stale comments

1. `src/inbox/concurrency.ts:6` — the "Extracted rather than duplicated"
   sentence is now true. Leave it, but add the third caller
   (`documentValidation`) to the list of callers named at `:2-4`, which
   currently names only `projectDigest.ts` and `MergedList.tsx`.
2. `src/store/useTodos.ts:158` — repoint "`mapWithConcurrency` in
   `projectDigest.ts`" to `src/inbox/concurrency.ts`.

**Verify**: `grep -rn "mapWithConcurrency in .projectDigest" src/` → no matches.

### Step 5: Guard the degenerate input, since you are here

`concurrency.ts` spawns `concurrency` workers; a value `<= 0` spawns none and
resolves an array of holes. Every call site passes a literal `5`, so there is
no live bug — but it is a one-line guard in the function you are already
consolidating:

```ts
const workers = Math.max(1, Math.floor(concurrency))
```

Add a test for `concurrency: 0` resolving all items.

**Verify**: `npx vitest run src/inbox/concurrency.test.ts` → passes including
the new case.

## Test plan

In `src/inbox/concurrency.test.ts`:
1–3. The three moved cases (bound respected, order preserved, all items mapped).
4. A rejecting `fn` rejects the call (the documented contract).
5. `concurrency: 0` still maps every item.

`documentValidation.test.ts` loses the moved block and keeps everything else.

**Verify**: `npm test` → all pass; total test count unchanged or higher.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] `src/inbox/concurrency.test.ts` exists with 5 tests
- [ ] `grep -c "async function mapWithConcurrency" src/inbox/sources/documentValidation.ts` → 0
- [ ] `grep -rn "projectDigest" src/store/useTodos.ts` → no stale pointer
- [ ] Step 1's equivalence verdict is in your report
- [ ] No orphaned `eslint-disable` left in `documentValidation.ts`
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 finds a behavioural difference between the copies. Report it — one of
  the two call-site sets has been relying on it.
- A `documentValidation` test fails after Step 3. The copies were not
  equivalent; revert and report.
- Removing the duplicate changes the `no-await-in-loop` lint outcome anywhere.
  Report rather than adding a blanket disable.

## Maintenance notes

- One bound, one test file, one doc comment. The reason this drifted is worth
  keeping in mind: the shared module was created by a plan that moved *one*
  copy and did not notice the second.
- A reviewer should check that the test file moved rather than being
  duplicated — two copies of the tests would recreate the same problem one
  layer up.
