# Plan 036: A failed persist write never retries — `dirtyRef` clears before the write actually succeeds

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/store/useDismissals.ts src/store/useSnoozes.ts src/store/useTodos.ts src/store/useAssessments.ts`
> If any of these changed since this plan was written, re-read them and
> compare against the excerpts below before proceeding — a change to the
> shared persist-effect shape in one file without the others could mean
> they've already diverged.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

Four per-editor stores (`useDismissals`, `useSnoozes`, `useTodos`,
`useAssessments`) share an identical persist-effect shape: on a local edit,
`dirtyRef.current` is set `true`; an effect watches `state` and, when dirty,
immediately sets `dirtyRef.current = false` **before** the write's own
promise has resolved, then fires the write and only `console.error`s on
failure. If that commit actually fails (network blip, a transient 409, a
permissions hiccup), `dirtyRef.current` is already `false` by the time the
failure is known — nothing re-marks it dirty, and nothing else re-triggers
this effect for the same `state` value again. If the editor makes no
*further* edit before closing the tab, that last edit is silently never
retried and never reaches the dataset, indistinguishable from having
worked. The console error is the only trace, and no editor is watching the
console.

This is a **correctness bug**, not a performance nicety: content an editor
believes they changed (dismissed something, snoozed something, added a
todo, recorded an AI assessment) can be quietly lost.

## Current state

The identical shape appears in all four files. From
`src/store/useDismissals.ts:143-160` (representative — the other three
differ only in type/field constant names and the log message):

```ts
useEffect(() => {
  if (!dirtyRef.current || !documentId || !loadedRef.current) return

  dirtyRef.current = false

  const value = JSON.stringify(state)

  client
    .transaction()
    .createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
    .patch(documentId, (patch) => patch.set({[DISMISSALS_FIELD]: value}))
    .commit({visibility: 'async'})
    .catch((error: unknown) => {
      // The local state stands for this session, so the tick the editor just
      // made still holds until they reload.
      console.error('[sanity-plugin-structure-inbox] could not save dismissals', error)
    })
}, [client, documentId, state])
```

Confirmed byte-identical in shape (only names differ) at:
- `src/store/useDismissals.ts:143-160` — `DISMISSALS_TYPE`/`DISMISSALS_FIELD`
- `src/store/useSnoozes.ts:86-101` — `SNOOZES_TYPE`/`SNOOZES_FIELD`
- `src/store/useTodos.ts:92-107` — `TODOS_TYPE`/`TODOS_FIELD`
- `src/store/useAssessments.ts:95-110` — `ASSESSMENTS_TYPE`/`ASSESSMENTS_FIELD`

**Why clearing `dirtyRef` eagerly, not just moving it, needs care**: the
effect's own deps are `[client, documentId, state]` — it only re-runs when
one of those actually changes. `dirtyRef.current = false` is set
synchronously, before `state` changes again, specifically so that if
*nothing else* about `state` changes, this effect does not try to
re-commit the exact same value on every unrelated re-render. That part is
correct and must be kept. The bug is narrower: on failure, nothing puts
`dirtyRef` back to `true`, so if this same effect is ever forced to run
again for an unrelated reason (e.g. `documentId` changes as the current
user is resolved a second time, or a future change causes an extra
re-render with the same `state`), the previously-failed write is silently
never retried even though the opportunity to retry it just presented
itself for free.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/store/useDismissals.ts`
- `src/store/useSnoozes.ts`
- `src/store/useTodos.ts`
- `src/store/useAssessments.ts`
- Each file's own `*.test.ts` (new test case per file, or one shared
  pattern applied to each — executor's judgment on whether a shared test
  helper is worth adding vs. four near-identical test blocks; these four
  stores do not share a test utilities file today, so introducing one is
  optional, not required)

**Out of scope**:
- Any other store or effect — this exact persist-effect shape is unique to
  these four files (confirmed: `grep -rln "dirtyRef.current = false"
  src/store/*.ts` returns exactly these four).
- The `update`/`add`/`write`/etc. functions that set `dirtyRef.current =
  true` on a local edit — unchanged; only the persist effect's own
  clear-on-failure behavior changes.
- Building any retry *schedule* (backoff, interval polling) — out of scope.
  This plan only ensures the *next* opportunity to persist isn't silently
  skipped; it does not manufacture new opportunities.

## Git workflow

- Commits land directly on `main`. Message style: `fix: don't clear the
  persist-dirty flag until a write actually succeeds`.
- One commit for all four files is fine — it's the same mechanical fix
  applied four times.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Fix the persist effect in each of the four files

In each file, move `dirtyRef.current = false` out of the synchronous body
and into the `.commit(...)` promise's success path, and re-set
`dirtyRef.current = true` in the `.catch()` — so a failed write leaves the
flag exactly as it was before this effect ran, ready to be retried the
next time this effect fires for any reason:

```ts
useEffect(() => {
  if (!dirtyRef.current || !documentId || !loadedRef.current) return

  const value = JSON.stringify(state)

  client
    .transaction()
    .createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
    .patch(documentId, (patch) => patch.set({[DISMISSALS_FIELD]: value}))
    .commit({visibility: 'async'})
    .then(() => {
      dirtyRef.current = false
    })
    .catch((error: unknown) => {
      // Left dirty on purpose: the write never actually landed, so the next
      // time this effect runs for any reason, it retries this same value
      // instead of silently treating a failed write as done.
      console.error('[sanity-plugin-structure-inbox] could not save dismissals', error)
    })
}, [client, documentId, state])
```

Apply the identical change to `useSnoozes.ts`, `useTodos.ts`, and
`useAssessments.ts`, substituting each file's own type/field constants and
log message — do not otherwise change the transaction shape, the
`{visibility: 'async'}` option, or the dep array.

**Verify** (after each file): `npm run typecheck` → exit 0.

### Step 2: Add a regression test per file

For each of the four stores' own test files, add a case that:
1. Makes a local edit (via that store's own update function — `dismiss`,
   `snooze`, `add`, `write`, whichever the file exposes).
2. Mocks the underlying `client.transaction().commit()` chain to reject
   once.
3. Confirms `console.error` was called (existing convention already
   covers this in some of these files — check first) **and** that a
   second render/effect run (e.g. triggered by a `documentId` change, or
   by directly re-invoking whatever causes this effect to re-run in the
   test's own harness) retries the commit rather than skipping it.

Follow whatever mocking pattern each file's own existing tests already use
for `client.transaction()` — do not introduce a new mocking style if an
existing one already covers this shape.

**Verify**: `npm test -- useDismissals && npm test -- useSnoozes && npm test -- useTodos && npm test -- useAssessments` → all pass, including the new cases.

### Step 3: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- One new regression case per file (four total), each proving: a failed
  commit leaves the store retry-eligible, and a subsequent opportunity to
  persist actually retries rather than silently no-op'ing.
- Verification: `npm test` → all pass, including all four new cases.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; one new regression test per file (four total)
      exists and passes
- [ ] `npm run build` exits 0
- [ ] `grep -rn "dirtyRef.current = false" src/store/*.ts` shows it only
      inside a `.then(...)` success callback in all four files, never
      synchronously before the write starts
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 036 updated

## STOP conditions

- Any of the four files' persist effect has already diverged from the
  shape quoted in "Current state" (confirms drift since this plan was
  written) — re-read that file in full and adapt the fix to its actual
  current shape rather than assuming it still matches.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

Any future per-editor store using this same "local state + debounced
persist effect" shape should copy the corrected version (clear dirty only
on confirmed success), not the version this plan fixes. If a fifth such
store appears, consider whether the shared shape is worth extracting into
one hook the four (soon five) stores all call — not done here, to keep
this plan a pure bug fix with no structural change.
