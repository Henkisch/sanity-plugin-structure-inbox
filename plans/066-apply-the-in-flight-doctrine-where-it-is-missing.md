# Plan 066: Finish applying the double-click guard this repo already wrote the doctrine for

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/MergedList.tsx src/inbox/Inbox.tsx src/inbox/MergedList.test.tsx src/inbox/Inbox.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — each change adds a synchronous ref check at the top of a handler. The shape is already proven in five places in this repo.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

This repo has a written doctrine about double-click guards, at
`src/inbox/Inbox.tsx:676-686`, and it is correct:

> a `summary.status === 'loading'` state check alone isn't enough here — two
> clicks landing in the same React batch (e.g.
> `act(() => { fireEvent.click(x); fireEvent.click(x) })`) both run before
> React commits the first click's `setSummary({status: 'loading'})`, so a state
> read is stale for both and both would fire; a `ref.current` write is visible
> to the very next line of JS regardless of whether React has re-rendered, so
> checking that instead closes the same-tick race too.

Five handlers follow it. Three do not, and they are the three where it costs
the most:

1. **`confirmQuickFix`** (`MergedList.tsx:525`) — the **bulk** fix. Guarded only
   by `setBusy(true)`. `grep` finds no `useRef` guard anywhere in
   `MergedList.tsx`. Two clicks in one batch run the whole batch twice: double
   writes to shared content documents.
2. **`runSourceAction`** (`Inbox.tsx:488`) — a source's own action (e.g. "Scan
   for issues"), which is typically a write-producing scan, not a read.
   Guarded only by `disabled={running}` reading component state. Worse, its
   `.finally` clears the running flag unconditionally, so with two runs in
   flight the first to settle re-enables the button while the second is still
   going.
3. **`handleSuggestSnooze`** (`MergedList.tsx:681`) — has
   `snoozeSuggestionRequestRef`, a bump-then-compare guard, but **no in-flight
   boolean**. Those two guard different things: the request id decides which
   *response* is authoritative; it does nothing to stop a second *request*.
   Its own comment two lines up notes that `suggestSnooze` "bills a real AI
   credit per call".

And `plans/README.md`'s plan 044 entry records the invariant as finished —
"All 6 handlers now use that pattern" — while this seventh site drifted. So
the codebase both has the rule and believes it is fully applied.

## Current state

**The doctrine and the correct shape** — `src/inbox/Inbox.tsx:686-687`:

```ts
const summarizeInFlightRef = useRef(false)
const summarizeRequestRef = useRef(0)
```

Read `handleSummarize` (`Inbox.tsx:688-727`) in full before writing anything —
it is the reference implementation: synchronous check-and-set at the top,
request-id bump, staleness comparison in `.then`, and the in-flight flag
cleared in `.finally`.

**Site 1 — `confirmQuickFix`, no ref at all** (`src/inbox/MergedList.tsx:525-531`):

```ts
const confirmQuickFix = useCallback(async () => {
  const targets = quickFixableTargets
  setBusy(true)
  try {
    const results = await mapWithConcurrency(targets, QUICK_FIX_CONCURRENCY, async (row) => {
```

Confirm for yourself: `grep -n "useRef(false)\|InFlightRef" src/inbox/MergedList.tsx`
returns nothing today.

**Site 2 — `runSourceAction`** (`src/inbox/Inbox.tsx:488-507`):

```ts
const runSourceAction = useCallback((report: SourceReport) => {
  const {action} = report
  if (!action) return
  const {name} = report.source
  setRunningActions((current) => ({...current, [name]: true}))
  dismissActionResult(name)
  action
    .run()
    .then((message) => { ... })
    .catch((error: unknown) => { ... })
    .finally(() => {
      setRunningActions((current) => ({...current, [name]: false}))
    })
}, [dismissActionResult])
```

Note: several `main` sources can each offer an `action` (see the comment at
`Inbox.tsx:475-477`), so the guard must be **keyed by source name**, not a
single boolean.

**Site 3 — `handleSuggestSnooze`** (`src/inbox/MergedList.tsx:664`, `:681-695`):

```ts
const [snoozeSuggestion, setSnoozeSuggestion] = useState<SnoozeSuggestionState>({status: 'idle'})
const snoozeSuggestionRequestRef = useRef(0)
...
const handleSuggestSnooze = useCallback(() => {
  if (!suggestSnoozeForRow || !singleSelectedRow) return
  const requestId = ++snoozeSuggestionRequestRef.current
  setSnoozeSuggestion({status: 'loading'})

  suggestSnoozeForRow(singleSelectedRow.item)
    .then((result) => {
      if (requestId !== snoozeSuggestionRequestRef.current) return undefined
      ...
```

**Repo conventions that apply here**:
- Error logging: `console.error('[sanity-plugin-structure-inbox] <message>', error)`.
- Tests fire two clicks in one batch with `act(() => { fireEvent.click(x); fireEvent.click(x) })` — see `src/inbox/Inbox.test.tsx:288` and `src/inbox/InboxRow.test.tsx:302` for the existing examples. Copy that shape.

## Commands you will need

| Purpose   | Command                                       | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                           | exit 0, no output   |
| Lint      | `npm run lint`                                 | exit 0, no output   |
| Two suites | `npx vitest run src/inbox/MergedList.test.tsx src/inbox/Inbox.test.tsx` | all pass |
| Full tests | `npm test`                                    | all pass            |

## Scope

**In scope:**
- `src/inbox/MergedList.tsx` — `confirmQuickFix`, `handleSuggestSnooze`
- `src/inbox/Inbox.tsx` — `runSourceAction`
- `src/inbox/MergedList.test.tsx`, `src/inbox/Inbox.test.tsx` — new tests

**Out of scope** (do NOT touch, even though they look related):
- The five handlers that already have the guard (`handleSummarize`, `handleSuggestTodos`, `handleFindContentGaps`, `InboxRow`'s assess and apply-fix, `AskInbox`'s submit). Do not refactor them into a shared hook here — that extraction is plan 084, and mixing it with this fix makes both harder to review.
- `setBusy` / `setRunningActions` / `disabled=` props. Keep them: they are the *visual* feedback. The ref is the correctness guard. Both should exist.
- The `snoozeSuggestionRequestRef` staleness guard. Keep it and **add** the in-flight flag alongside; they guard different things.

## Git workflow

- Branch: `advisor/066-in-flight-guards`
- Conventional Commits. This is a `fix:`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Guard `confirmQuickFix`

Add a ref beside the existing `busy` state and check it synchronously:

```ts
// `busy` drives the disabled state; this ref is what actually closes the
// race. Two clicks landing in the same React batch both read the pre-commit
// `busy === false`, so a state check alone lets both run the whole batch —
// which for this action means every selected row's fix applied twice, to
// real shared documents. See `Inbox.tsx`'s own note above
// `summarizeInFlightRef` for the full reasoning.
const quickFixInFlightRef = useRef(false)

const confirmQuickFix = useCallback(async () => {
  if (quickFixInFlightRef.current) return
  quickFixInFlightRef.current = true
  const targets = quickFixableTargets
  setBusy(true)
  try {
    // ...unchanged
  } finally {
    quickFixInFlightRef.current = false
    // ...whatever the existing finally/cleanup does
  }
}, [/* unchanged deps */])
```

Read the existing function's end to see how `setBusy(false)` is currently
handled and clear the ref in the same place. The ref must be cleared on **both**
success and failure, or one failed bulk fix disables the action permanently.

**Verify**: `npx vitest run src/inbox/MergedList.test.tsx` → all pass.

### Step 2: Guard `handleSuggestSnooze`

Add the in-flight flag alongside the existing request ref:

```ts
const snoozeSuggestionRequestRef = useRef(0)
// Distinct from the request ref above, which only decides *which response*
// wins. This one stops the second *request* — and this call bills a real AI
// credit, so a double-click is a double charge.
const snoozeSuggestionInFlightRef = useRef(false)
```

then at the top of the handler:

```ts
if (!suggestSnoozeForRow || !singleSelectedRow) return
if (snoozeSuggestionInFlightRef.current) return
snoozeSuggestionInFlightRef.current = true
```

and clear it in a `.finally` on the promise chain.

**Verify**: `npx vitest run src/inbox/MergedList.test.tsx` → all pass.

### Step 3: Guard `runSourceAction`, keyed by source

A single boolean is wrong here — several sources can each have an action.

```ts
// Keyed by source name: several `main` sources can each offer an action
// (see the note above `actions` below), so one boolean would let a second
// source's action be swallowed by the first's. State alone is not enough for
// the same-batch case — see `summarizeInFlightRef`.
const runningActionsRef = useRef<Set<string>>(new Set())
```

then:

```ts
const runSourceAction = useCallback((report: SourceReport) => {
  const {action} = report
  if (!action) return
  const {name} = report.source
  if (runningActionsRef.current.has(name)) return
  runningActionsRef.current.add(name)
  setRunningActions((current) => ({...current, [name]: true}))
  ...
    .finally(() => {
      runningActionsRef.current.delete(name)
      setRunningActions((current) => ({...current, [name]: false}))
    })
```

The existing `.finally` already writes the per-name state, so scoping the ref
delete next to it also fixes the secondary problem noted in "Why this matters":
the clear is now per source rather than global.

**Verify**: `npx vitest run src/inbox/Inbox.test.tsx` → all pass.

### Step 4: Correct the record in `plans/README.md`

Plan 044's entry states "All 6 handlers now use that pattern". After this plan
it is nine (six plus these three). Update that sentence so it is true, and note
that the count is a thing to re-check when a new handler is added.

**Verify**: `grep -n "All 6 handlers" plans/README.md` → no matches.

## Test plan

Three new tests, one per site, each firing two clicks in a single React batch
and asserting the underlying work happened **once**. Copy the shape from
`src/inbox/Inbox.test.tsx:288` (`suggestTodos`) — it is the same assertion
against the same class of bug.

1. `MergedList.test.tsx` — two clicks on the bulk quick-fix action with two
   `quickFixable` rows selected: `proposeFix` is called exactly twice (once per
   row), not four times. Asserting the per-row call count rather than a single
   handler call is what makes this test meaningful for a *bulk* action.
2. `MergedList.test.tsx` — two clicks on "Suggest a time": the source's
   `suggestSnooze` is called exactly once.
3. `Inbox.test.tsx` — two clicks on a source action: `action.run` is called
   exactly once. Add a second assertion that an action on a *different* source
   can still run concurrently (this is what the `Set` keying buys, and a single
   boolean would fail it).

**Verify**: `npm test` → all pass, with 3–4 new tests.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with the new tests
- [ ] `grep -c "InFlightRef\|runningActionsRef" src/inbox/MergedList.tsx src/inbox/Inbox.tsx` shows hits in both files
- [ ] Each of the three new tests was confirmed to **fail** before the corresponding guard was added (state this per test in your report — a double-click test that passes without the guard is not testing anything)
- [ ] The ref is cleared on both the success and failure paths at all three sites
- [ ] `grep -n "All 6 handlers" plans/README.md` → no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A double-click test passes before you add the guard. Either the test is not
  landing both clicks in one batch, or something upstream already serialises
  them — find out which and say so, rather than adding a guard whose value you
  cannot demonstrate.
- `confirmQuickFix` has no single place where both the success and failure
  paths converge. Clearing the ref in only one of them is worse than not
  guarding at all (the action would lock permanently after one failure) — stop
  and report the structure you found.
- You find a fourth unguarded async handler. Report it; do not expand this
  plan's scope silently.

## Maintenance notes

- Any new async handler in this pane needs this guard. Plan 084 proposes
  extracting a `useAiRead` hook that would make it structural rather than
  remembered; until that lands, this is a review checklist item.
- A reviewer should ask for the "did the test fail first?" evidence on each of
  the three tests. That is the only thing that distinguishes a real guard from
  a decorative one.
- The distinction worth preserving in the comments: an **in-flight ref** stops
  a second request; a **request-id ref** decides which response wins. Site 3
  needs both, and the reason it drifted is that having one looked like having
  the other.
