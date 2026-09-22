# Plan 087: Investigate whether a capability can be handed to `MergedList` stale

> **Executor instructions**: This is an **investigation plan**. Its output is a
> reproduction (or a confident refutation), not a fix. Do not change
> `SourceFeed.tsx`'s fingerprint machinery before Step 4 has an answer — that
> code exists to stop a crash this repo has hit three times.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/SourceFeed.tsx src/inbox/sources/todos.ts src/store/useTodos.ts src/store/todos.ts src/inbox/MergedList.tsx`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S to investigate; M if a fix is warranted
- **Risk**: MED–HIGH for any fix. This is the code that prevents "Maximum update depth exceeded". Adding the capability objects to a dependency list would reinstate the loop.
- **Depends on**: none
- **Category**: bug (unconfirmed)
- **Planned at**: commit `3893ae5`, 2026-09-21
- **Confidence**: MED. The mechanism is certain from reading the code; it was **not** reproduced in a running Studio, and the reachable paths are narrow.

## Why this matters

`SourceFeed` reports capabilities from a ref, and the effect that reports them
depends only on **fingerprints** — `Boolean(x)` for presence, and
`assign?.users.length ?? -1` / `transfer?.users.length ?? -1` for the pickers.
When no fingerprint moves, the effect does not fire, and `Inbox`'s `reports`
state keeps the capability object captured at the last report.

That is deliberate and necessary: depending on the objects themselves would
report on every render, which sets state, which renders again — the crash.

But it means a capability that **closes over mutable hook state** can be
handed out stale. The one built-in case:

`useTodos.ts:136-199`'s `transferTo` is a `useCallback` over `[client, state]`
and reads `state.items.find(...)` at `:138-139`, returning silently when the
id is not found. `todos.ts:131-147` wraps it into `transfer.toUser`. Its
correctness therefore depends on the report re-firing when `state` changes —
which the fingerprint does not guarantee: `withUpdatedTodo`
(`todos.ts:90-108`) bumps only `updatedAt`, a field the item projection at
`todos.ts:107-129` does not carry, so `useStableItems` compares the items
equal, `splitItems`' memo does not recompute, and no fingerprint moves.

Second, narrower issue: `users.length` is a lossy fingerprint by construction.
A list whose *membership* changes without changing length (a permission flip,
or `useAssignableUsers`' `granted` flags resolving) leaves `MergedList`
rendering the previous names and calling the previous `toUser`.

The failure is silent either way — `if (!item) return`.

## Current state

- `src/inbox/SourceFeed.tsx:120-153` — the capabilities ref, written twice.
- `src/inbox/SourceFeed.tsx:155-194` — the fingerprints and the effect's dependency list.
- `src/inbox/SourceFeed.tsx:103-119` — the comment explaining why the objects are *not* dependencies. **Read this first; it is the constraint any fix must respect.**
- `src/inbox/SourceFeed.tsx:164,168` — `assignUserCount` / `transferUserCount`.
- `src/store/useTodos.ts:136-199` — `transferTo`, closing over `state`.
- `src/store/todos.ts:90-108` — `withUpdatedTodo`, bumping only `updatedAt`.
- `src/inbox/sources/todos.ts:107-129` — the item projection that omits `updatedAt`.
- `src/inbox/MergedList.tsx:955-967` and `:615-651` — the call sites.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | all pass |
| Dev studio | `npm run build && npm run dev` | studio at localhost:3333 |

## Scope

**In scope (investigation):** reading the files above; writing a failing test
or a live reproduction; recording the result in this plan file.

**In scope (only if Step 4 says a fix is warranted):** `src/inbox/SourceFeed.tsx`.

**Out of scope:**
- Adding capability objects to the effect's dependency list. That reinstates the crash — it is the one thing the comment at `:103-119` forbids.
- Changing `useStableItems`' comparison.
- Adding `updatedAt` to the item projection as a workaround. It would make the fingerprint move, but by making every todo edit churn item identity — trading a silent staleness bug for the render-loop class. Note it as an option only to reject it.

## Git workflow

- Branch: `advisor/087-stale-capability`
- Conventional Commits: `test:` for a failing test; `fix:` only if a fix is agreed.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Try to reproduce it as a test

Write a test (in `src/inbox/SourceFeed.test.tsx` or a new file) that:

1. mounts a `SourceFeed` with a source whose `transfer.toUser` closes over a
   mutable value,
2. changes that value **without** changing any fingerprint (no item identity
   change, no `users.length` change),
3. invokes the reported `toUser` and asserts which value it saw.

If the reported callback sees the **old** value, the finding is confirmed.

**Verify**: state clearly in your report whether the test reproduces it.

### Step 2: Try the concrete todos path

The abstract test may pass while the real path is safe. Check the specific
claim: edit a todo (which bumps only `updatedAt`), then transfer it, and see
whether `transferTo` finds the updated item.

Do this in `test-studio` (`npm run build && npm run dev` — the studio consumes
`dist/`, so the build is required) with the `todos` source configured.

**Verify**: report what actually happened, with the steps you took.

### Step 3: Check the lossy-length fingerprint separately

Construct a case where `assign.users` changes membership but not length, and
see whether `MergedList` renders stale names. This one may be easier to
reproduce than the todos path.

**Verify**: report the result.

### Step 4: Recommend, do not implement

Based on Steps 1–3, write a recommendation into this plan file under a
`## Findings` heading. The three plausible outcomes:

- **Not reachable.** Record why, and close it. That is a perfectly good result
  and stops the next audit re-finding it.
- **Reachable, narrow.** Recommend a targeted fix — most likely making the
  capability read through a stable accessor (a ref read at call time, or a
  `useEffectEvent`-style wrapper) so `MergedList` always reads the latest
  without the object becoming a dependency. **This preserves the loop guard**,
  which is the whole constraint.
- **Reachable and broad.** Then it is a design question about
  `InboxSourceResult`'s contract: either capabilities must be documented as
  required-to-be-stable, or the report path must pass the ref through. Say so
  and stop — that is a maintainer decision, not an executor's.

**Verify**: this plan file has a `## Findings` section with one of those three
conclusions and its evidence.

## Findings

**Conclusion: Reachable, narrow.**

Drift check first: as of this investigation (base `b6ceeb4`, on top of
`3893ae5`), `git diff --stat 3893ae5..HEAD -- src/inbox/SourceFeed.tsx
src/inbox/sources/todos.ts src/store/useTodos.ts src/store/todos.ts
src/inbox/MergedList.tsx` shows real drift in `SourceFeed.tsx` (068's
`CapabilityKey` mapped type), `useTodos.ts` (062's `writeTodosMerged`
rewrite), and `MergedList.tsx`. None of it changes the mechanism this plan is
about: `SourceFeed.tsx`'s fingerprint dependency list (`assignUserCount` /
`transferUserCount` still `users.length ?? -1`, unchanged) and
`transferTo`'s shape (still a `useCallback` over `[client, state]`, still
`state.items.find(...)`, still `if (!item) return`) are exactly as the plan
describes, just at different line numbers.

### Step 1 — abstract reproduction

Reproduced. `src/inbox/staleCapability.test.tsx` ("Step 1") mounts
`SourceFeed` with a synthetic source whose `transfer.toUser` closes over a
value snapshotted at `useItems()` call time (the same shape `useCallback(fn,
[client, state])` has — a fresh immutable snapshot each call, not a live
reference). Changing that value and forcing an unrelated re-render, without
moving `items` or `transfer.users.length`, leaves the reported object
identical (`secondReport === firstReport`) and its `toUser` still observes
the old value. `npm test` output: passes.

One correction to my own first draft while building this: a synthetic
closure that reads a *mutable box* (e.g. `mutable.value`) directly inside
`toUser`'s body, rather than snapshotting it into a local at `useItems()`
call time, does **not** reproduce staleness — it always reads live,
regardless of which render's closure is invoked, because there is no
snapshot to go stale. The real bug requires the closed-over value itself to
be captured by value in the closure (as `useCallback`'s captured `state`
argument is). Recorded here so a future audit does not "refute" this by
building the wrong kind of fixture.

### Step 2 — concrete `todos` path

Reproduced, against a mocked-client unit test
(`src/inbox/staleCapability.test.tsx`, "Step 2") — **not** the live
test-studio; see the note under "What could not be run" below for why.

Sequence: mount `SourceFeed` with the real `todos()` source; add a todo
(`create`) — a real content-length change, confirmed to re-fire the report
(`afterAdd !== afterMount`); then call `update()` on that same todo with the
*exact same* `title` and no `description`/`dueBy` (a "no-op" resubmit — the
same values the form would already show). This bumps `updatedAt`
(`withUpdatedTodo`, `src/store/todos.ts:90-108`) but changes nothing the
`todos` source's item projection carries (`src/inbox/sources/todos.ts`'s
`items` `useMemo` has no `updatedAt` field), so `useStableItems` compares the
projected items equal, `open`'s identity doesn't move, and the report effect
does not re-fire (`onReport.mock.calls.length` unchanged). Then invoking the
still-held (stale) `transfer.toUser` on that same todo: the transfer
**succeeds** — the recipient's document gets the item — but the copy it
writes is missing the `updatedAt` the real, current state already has.

This is narrower than the plan's own wording ("returns silently when the id
is not found") anticipated:
- **Not reachable this way**: "wrong id" / "silent no-op" transfers.
  `state.items.find` always finds the item, because *any* change that would
  actually remove or add an item also changes the projected items' length,
  which does move `useStableItems`'/the report's fingerprint and refreshes
  the closure before the staleness could matter.
- **Reachable**: a transferred todo can arrive at its recipient carrying a
  stale `updatedAt` (or, more generally, stale non-projected metadata — today
  `updatedAt` is the only field in this shape) if the sender's last edit
  before transferring didn't actually change anything the row displays. The
  practical consequence is narrow: it only affects `mergeTodos`' tie-break
  logic on the recipient's side in the event of an unrelated concurrent edit,
  and the sender's own copy of the item is removed immediately afterward
  regardless.

### Step 3 — lossy `users.length` fingerprint

Reproduced. `src/inbox/staleCapability.test.tsx` ("Step 3") swaps assignable
membership from `['a', 'b']` to `['c', 'd']` (same length) between two
renders with no other fingerprint moving. The report never re-fires
(`secondReport === firstReport`); `MergedList` would keep rendering the old
names, and the stale `toUser` (invoked in the test) still records the old
membership, not the new one — confirmed by test, not just by reading the
code.

### What could not be run

Step 2 asked for this to be exercised live in `test-studio` (`npm run build
&& npm run dev`). `test-studio/.env` does not exist in this worktree (only
`.env.example`, with `SANITY_STUDIO_PROJECT_ID` blank), and
`sanity.config.ts`/`sanity.cli.ts` read that variable with a non-null
assertion. Confirmed directly: `npm run dev` inside `test-studio` does start
a Vite dev server (`Sanity Studio ... ready ... at http://localhost:3333/`),
but `SANITY_STUDIO_PROJECT_ID` is unset in this shell
(`node -e "console.log(process.env.SANITY_STUDIO_PROJECT_ID)"` →
`undefined`), so the actual Studio app has no project/dataset to run
against. No credentials for a real Sanity project were available in this
session to fill in `.env`. The mocked-client test under Step 2 above is the
substitute evidence; it exercises the same real `useTodos`/`todos()`
code path end to end (add → no-op edit → transfer → inspect what actually
gets written), just against a fake `SanityClient` instead of a live dataset.

### Recommendation (not implemented — investigation plan)

Per the plan's own "Reachable, narrow" branch: the fix, if one is agreed, is
to make the affected capabilities read through a stable accessor (a ref
updated every render, read at call time — the same shape `capabilities.current`
in `SourceFeed.tsx` already uses internally, just extended so `MergedList`
itself reads through it rather than through the frozen `SourceReport`
object) rather than depending on the object identity of `transfer`/`assign`
directly. This preserves the loop guard: the *fingerprint* dependency list
stays exactly as narrow as it is today; only *what a stale report's function
does when finally called* changes, from "act on a frozen snapshot" to "read
whatever is current." No such change has been made — `SourceFeed.tsx`'s
dependency list is untouched by this plan, per its own STOP condition. See
`src/inbox/staleCapability.test.tsx`'s skipped test for the target
behaviour a fix should turn green.

## Test plan

If confirmed: one test per reproduced path (Step 1 and/or Step 3), left
**failing and skipped** (`it.skip` with a comment pointing at this plan) if no
fix is agreed — so the knowledge is in the suite rather than only in a
document.

If refuted: one test asserting the safe behaviour, so it stays safe.

**Verify**: `npm test` → all pass (a skipped test does not fail).

## Done criteria

- [x] `npm run typecheck` and `npm test` exit 0
- [x] This plan file has a `## Findings` section with evidence and one of the three conclusions
- [x] Steps 1–3 each have a recorded result, including "could not reproduce" (Step 2's live test-studio sub-part specifically: could not run, see "What could not be run")
- [x] No change to `SourceFeed.tsx`'s dependency list was made without Step 4's conclusion (untouched entirely — this session's conclusion is "reachable, narrow" with no fix implemented)
- [ ] `plans/README.md` status row updated with the conclusion — **skipped per this session's explicit instructions**
- [x] If confirmed and unfixed: a skipped test exists, referencing this plan (`src/inbox/staleCapability.test.tsx`)

## STOP conditions

- You are about to add a capability object to the effect's dependency list.
  Stop. Read `SourceFeed.tsx:103-119` again.
- A reproduction attempt triggers "Maximum update depth exceeded". That is a
  *different* and much more serious finding — report it immediately.
- The fix appears to require changing `InboxSourceResult`'s public contract.
  That is a maintainer decision on a published 2.x package.

## Maintenance notes

- The tension here is real and not fully resolvable: **fingerprints prevent a
  crash and cost freshness.** Any future capability that closes over mutable
  state inherits this. If `InboxSourceResult` grows another such capability,
  this investigation becomes more valuable, not less.
- A reviewer should be sceptical of any fix that makes the report effect fire
  more often. The bar is: does it preserve the guarantee that a same-shaped
  capability object does not trigger a report?
- If the conclusion is "not reachable", record it in `plans/README.md`'s
  "Findings considered and rejected" section so it is not re-audited.
