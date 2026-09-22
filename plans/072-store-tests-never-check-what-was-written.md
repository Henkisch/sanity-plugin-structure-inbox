# Plan 072: Assert what the store writes, not just that it wrote

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/store/`
> On any mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — tests only.
- **Depends on**: none. (Plan 062 rewrites `useTodos`' write path; if both run, do 062 first and re-read its excerpts.)
- **Category**: tests
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

All four per-editor stores write real documents into the **customer's** dataset.
Every persist assertion in their test suites checks only that a mock was
called:

```ts
expect(transaction.commit).toHaveBeenCalledTimes(1)
```

Grepping the four suites finds **zero** assertions on the arguments to
`createIfNotExists` or `patch`. So the payload — which includes the per-editor
document `_id`, derived from the user id — is untested.

The regression that matters: drop the user suffix from `documentId` and every
editor in a workspace shares one dismissals/snoozes/todos document. One
person's "mark done" hides rows for the whole team. That is a cross-user data
leak with a write attached, and **all 533 tests would still pass**.

## Current state

The four persist sites, all the same shape — e.g. `src/store/useDismissals.ts:150-152`:

```ts
.createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
```

Siblings: `src/store/useSnoozes.ts:93`, `src/store/useTodos.ts:103`,
`src/store/useAssessments.ts:102`.

The call-count assertions: `src/store/useDismissals.test.tsx:93`,
`useSnoozes.test.tsx:82`, `useTodos.test.tsx:79`, `useAssessments.test.tsx:81`,
plus ~12 more sites.

**The quality bar to match**: `src/store/useTodos.test.tsx:172-240` uses a
*stateful* stub (its `fetch` returns what the previous `patch` wrote). That is
what the rest of these files should look like.

**Secondary (same plan)**: four negative assertions prove "did not write" by
`await new Promise((r) => setTimeout(r, 10))` on real timers —
`useDismissals.test.tsx:110`, `useSnoozes.test.tsx:98`, `useTodos.test.tsx:93`,
`useAssessments.test.tsx:95` and `:139`. The direction is benign (it
under-waits rather than flaking red), but "did not write" really means "did not
write within 10ms". These files already have a `deferred()` helper; use it.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| These suites | `npx vitest run src/store/` | all pass |
| Full tests | `npm test` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope:** `src/store/useDismissals.test.tsx`, `src/store/useSnoozes.test.tsx`,
`src/store/useTodos.test.tsx`, `src/store/useAssessments.test.tsx`

**Out of scope:** every `src/store/*.ts` implementation file. This plan adds
assertions to existing behaviour; if an assertion fails, that is a **finding**,
not a licence to change the implementation — report it.

## Git workflow

- Branch: `advisor/072-store-payload-tests`
- Conventional Commits: `test:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Assert the document id and payload in each suite

For each of the four suites, add to the existing persist test (or a new one
beside it):

```ts
expect(transaction.createIfNotExists).toHaveBeenCalledWith(
  expect.objectContaining({
    _id: 'structureInbox.dismissals.user-1', // the real shape — read it from the implementation
    _type: DISMISSALS_TYPE,
  }),
)
```

Read the actual `documentId` construction in each `use*.ts` first and assert
the **real** string, including the user suffix. Hardcode the expected id; that
is the point — a test that recomputes it the same way the implementation does
cannot catch the suffix being dropped.

Then assert the value round-trips: take the string passed to `patch.set(...)`,
run it through that store's own `parse*` function, and assert the parsed result
equals what was put in.

**Verify**: `npx vitest run src/store/` → all pass.

### Step 2: Add the cross-user regression test

One test per suite, named so the risk is unmissable, e.g.
`writes to a document id unique to this editor, never a shared one`:

render the hook with two different user ids in turn and assert the two writes
used **different** `_id`s.

**Verify**: `npx vitest run src/store/` → all pass.

### Step 3: Replace the real-timer negative waits

At the five sites listed above, replace `setTimeout(..., 10)` with a
deterministic settle using the file's existing `deferred()` helper (resolve it,
then `await Promise.resolve()`), so "did not write" means "did not write",
not "did not write yet".

**Verify**: `npx vitest run src/store/` → all pass, and
`grep -rn "setTimeout(r, 10)\|setTimeout(resolve, 10)" src/store/` returns no
matches.

## Test plan

Per suite: one payload assertion (Step 1), one distinct-id test (Step 2).
Eight new/strengthened tests total. Model on `useTodos.test.tsx:172-240`.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Each of the four suites asserts the real `_id` string and a round-tripped payload
- [ ] Each of the four suites has a distinct-id-per-user test
- [ ] `grep -rn "setTimeout(r, 10)" src/store/` → no matches
- [ ] Your report confirms each new assertion was checked against the implementation (i.e. the expected `_id` was read from the code, not guessed)
- [ ] `git status` shows only the four test files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any new assertion **fails** against current behaviour. That is a live bug —
  report it with the actual vs expected payload; do not adjust the assertion to
  match, and do not change the implementation.
- A store's `documentId` turns out not to include a user suffix at all. Stop
  and report: that is the cross-user leak, live.
- Removing a real-timer wait makes a test flaky in the other direction (fails
  intermittently). Report rather than reinstating the sleep.

## Maintenance notes

- The rule: a store test asserts the **payload and the document id**, not the
  call count. A future store added to `src/store/` should ship with both.
- A reviewer should check that expected `_id` strings are literals — a test
  that derives the id the same way the code does proves nothing about the id.
