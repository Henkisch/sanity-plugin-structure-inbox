# Plan 070: Make the assessment cache actually apply, and never show a verdict about a stale draft

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/InboxRow.tsx src/inbox/InboxRow.test.tsx src/inbox/MergedList.tsx src/store/useAssessments.ts src/store/assessments.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — one state-sync addition, guarded by the in-flight ref that already exists.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Two problems, one cause.

`InboxRow` reads its cached AI assessment **once**, in a lazy `useState`
initializer. A lazy initializer runs on the row's first render only, and
`initialAssessment` is referenced nowhere else in the file — no effect, no key
change.

1. **The cache is a coin flip.** `MergedList` recomputes `initialAssessment`
   every render from `assessments?.read(...)`, but the assessments store loads
   asynchronously. On a cold pane the rows routinely mount *before* that
   document resolves, so `initialAssessment` is `undefined` at mount and the
   later value is discarded. The editor clicks "Ask AI" again and pays for a
   read the cache exists to avoid.

2. **A row can show a verdict about a draft that no longer exists.** The cache
   layer invalidates correctly — `assessments.read()` takes `changedAt` and
   returns nothing for a since-edited document, and
   `src/store/assessments.ts:66-77` states the guarantee it exists to provide:
   never "a confidently-wrong 'looks ready to publish' on a since-edited
   draft". But the row's row key is `${sourceName} ${item.id}`
   (`src/inbox/mergeItems.ts:104`), which does **not** change when the document
   is edited. So the component does not remount, the local state survives, and
   the invalidated verdict stays on screen. The guarantee is defeated one layer
   above the layer that implements it.

## Current state

**The read-once initializer** — `src/inbox/InboxRow.tsx:252-254`:

```ts
const [assessment, setAssessment] = useState<Assessment>(() =>
  initialAssessment ? {status: 'done', ...initialAssessment} : {status: 'idle'},
)
```

Confirm for yourself: `grep -n "initialAssessment" src/inbox/InboxRow.tsx`
returns exactly three hits — the prop type, the destructure, and this
initializer.

**The value that arrives late** — `src/inbox/MergedList.tsx:902-904`:

```ts
const initialAssessment = report?.assess
  ? (assessments?.read(row.sourceName, row.item.id, row.item.changedAt) ?? undefined)
  : undefined
```

**The guard already in the file, to reuse** — `src/inbox/InboxRow.tsx:308-309`:

```ts
const assessInFlightRef = useRef(false)
const assessRequestRef = useRef(0)
```

Its comment (`:305-307`) explains the ref-vs-state distinction. This plan must
not stomp a `loading` state or a just-returned live result with a late cache
read, and these refs are how you tell.

**Repo conventions that apply here**:
- The "adjust state when a prop changes" pattern (render-phase compare-and-set, not an effect) is already used in this repo at `src/inbox/useStableItems.ts:123`, with an `eslint-disable-next-line refs` comment. That is the cheaper and more idiomatic route here; an effect is acceptable but will render once with the stale value first.
- This pane has been taken down three times by render-phase update loops (`AGENTS.md`). Any compare-and-set must be guarded by a condition that provably stops changing.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                           | exit 0, no output   |
| Lint      | `npm run lint`                                 | exit 0, no output   |
| This suite | `npx vitest run src/inbox/InboxRow.test.tsx`  | all pass            |
| Full tests | `npm test`                                    | all pass            |

## Scope

**In scope:**
- `src/inbox/InboxRow.tsx`
- `src/inbox/InboxRow.test.tsx`

**Out of scope** (do NOT touch, even though they look related):
- `src/store/assessments.ts` and `src/store/useAssessments.ts` — the cache layer is correct. The bug is that the row ignores it.
- `src/inbox/MergedList.tsx` — it already recomputes the value correctly every render.
- `src/inbox/mergeItems.ts`'s row key. Making the key include `changedAt` would remount the row on every edit, which also resets selection and any in-flight fix — a worse cure than the disease.

## Git workflow

- Branch: `advisor/070-assessment-sync`
- Conventional Commits: `fix:`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Adopt a cache value that arrives after mount

Add a render-phase sync keyed on the two inputs that should drive it:
`item.changedAt` and `initialAssessment`.

```ts
// `initialAssessment` is recomputed by `MergedList` every render, but the
// assessments store loads asynchronously — so on a cold pane this row
// usually mounts before the cache document resolves, and a lazy `useState`
// initializer would throw that value away. It also has to be *dropped* when
// the document changes: `assessments.read()` invalidates on `changedAt`
// (see `src/store/assessments.ts:66-77` — the cache exists to never show
// "looks ready to publish" about a since-edited draft), but this row's key
// does not include `changedAt`, so the component does not remount and the
// local copy would outlive the invalidation.
const [syncedFor, setSyncedFor] = useState<string | undefined>(item.changedAt)
if (syncedFor !== item.changedAt && !assessInFlightRef.current) {
  setSyncedFor(item.changedAt)
  setAssessment(initialAssessment ? {status: 'done', ...initialAssessment} : {status: 'idle'})
}
```

That handles case 2 (stale verdict dropped on edit). For case 1 (late cache
arrival) you also need to adopt a value that appears while `changedAt` is
unchanged:

```ts
const [adopted, setAdopted] = useState(Boolean(initialAssessment))
if (!adopted && initialAssessment && assessment.status === 'idle' && !assessInFlightRef.current) {
  setAdopted(true)
  setAssessment({status: 'done', ...initialAssessment})
}
```

Both conditions must provably stop being true after they fire — that is what
keeps this out of a render loop. Convince yourself of that and state the
argument in your report; do not just assert it.

Three properties that must hold:
1. A `loading` assessment is never overwritten (`assessInFlightRef.current` guard).
2. A live result that just came back is never overwritten by a cache read.
3. When `item.changedAt` moves, a `done` assessment is cleared.

If the two-flag shape above feels fragile, an alternative is a single
`useEffect` on `[item.changedAt, initialAssessment]` with the same guards. It
renders one frame with the stale value, which for this case is acceptable.
Choose one, and say which and why.

**Verify**: `npx vitest run src/inbox/InboxRow.test.tsx` → all pass.

### Step 2: Prove it cannot loop

This is the check that matters most, given this pane's history.

**Verify**: add a temporary render counter to the component
(`const renders = useRef(0); renders.current++`), render the row with a
`MergedList`-style parent that recomputes `initialAssessment` on every render,
and assert the count settles. Remove the counter afterwards. Report the
observed count.

### Step 3: Confirm the invalidation contract end to end

Read `src/store/assessments.ts:66-77` and confirm your Step 1 change actually
delivers what it promises: a row whose document changed shows no verdict.

**Verify**: covered by test 3 below.

## Test plan

New tests in `src/inbox/InboxRow.test.tsx`. Model them on the existing assess
tests at `:279` and `:302`.

1. **Late cache arrival (bug 1)**: render with `initialAssessment: undefined`,
   then re-render with a value. The row displays the assessment. Before this
   plan it stays idle.
2. **Never stomps a live read**: with an assess in flight (`onAssess` pending),
   a late `initialAssessment` arriving does **not** replace the `loading`
   state.
3. **Stale verdict dropped (bug 2)**: render with an `initialAssessment` and a
   `changedAt`; re-render with a *new* `changedAt` and `initialAssessment:
   undefined` (which is what the cache returns after invalidation). The row no
   longer shows the old verdict. Name the test so the guarantee is obvious —
   this is the one protecting against a confidently-wrong verdict.
4. **A returned live result survives a re-render** that recomputes
   `initialAssessment` as `undefined` (the cache write may not have landed
   yet).

**Verify**: `npm test` → all pass, with 4 new tests.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 4 new tests
- [ ] Tests 1 and 3 were confirmed to **fail** before the change (state this in your report)
- [ ] Step 2's render-count check was run and the count is recorded as settling
- [ ] `grep -c "initialAssessment" src/inbox/InboxRow.tsx` → more than 3 (it is now actually used)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2's render count does not settle. Do not ship a render-phase set you
  cannot show terminates; switch to the `useEffect` variant and re-measure, or
  report.
- You find that `item.changedAt` is `undefined` for some sources. Then it
  cannot be the sync key on its own — report what the sources actually provide
  rather than inventing a fallback key.
- Making test 3 pass requires changing `MergedList` or the assessments store.
  Both are out of scope and correct; the row is what needs fixing.

## Maintenance notes

- The invariant: **a cached AI verdict must never outlive the document version
  it was about.** The cache layer enforces it on read; after this plan the row
  enforces it in local state too. Both halves are needed, and a future
  refactor that reintroduces "read the cache once" breaks the second half
  silently.
- A reviewer should scrutinise the loop-termination argument in Step 1 and ask
  for Step 2's number.
- Deferred: `fix` state (`FixState`) has the same read-once shape but no cache
  behind it, so there is nothing to sync. If a fix cache is ever added, this
  plan is the precedent.
