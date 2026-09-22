# Plan 082: Let a source come back after one transient throw

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/ui/SectionErrorBoundary.tsx src/ui/SectionCard.tsx src/studio/inboxCountLayout.tsx src/inbox/Inbox.tsx src/inbox/MergedList.tsx`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED — a boundary that resets can loop if the throw is deterministic, which is exactly what this boundary exists to contain. The retry must be bounded.
- **Depends on**: none. Related to plan 063 (observable-level recovery); the two are complementary, not overlapping.
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`SectionErrorBoundary` latches. `error` is set by `getDerivedStateFromError`
and never cleared — no `componentDidUpdate`, no `resetKeys`, no remount key.
Once it catches, it renders the fallback forever.

Two consequences, both silent under-reporting:

1. **The navbar badge loses that source for the whole tab.** The boundary
   around `OpenCountFeed` (`inboxCountLayout.tsx:140-148`) is keyed only by
   `source.name`, so it never remounts — and that provider is mounted at
   `studio.components.layout`, which lives as long as the browser tab. After
   one throw, `handleCount(source.name, null)` fires once and the source
   contributes `0` to `useInboxOpenCount()` forever. There is no navigation
   that resets it.
2. **The pane loses that source's rows.** `BoundedSourceFeed`
   (`Inbox.tsx:341-356`) reports `{error, open: [], cleared: [], snoozed: []}`,
   `MergedList` draws one small error card, and the rows never come back even
   once the underlying query would succeed.

So a transient failure — a dropped listener, a 5xx on first fetch — is
indistinguishable from a permanently broken source, and the README-advertised
badge under-reports until the editor reloads the Studio.

## Current state

`src/ui/SectionErrorBoundary.tsx:32-51` — `error` state set and never cleared.

`src/studio/inboxCountLayout.tsx:140-148` — the boundary keyed by
`source.name` only.

`src/studio/inboxCountLayout.tsx:130-133` — where a `null` count becomes `0`
in the sum.

`src/inbox/Inbox.tsx:341-356` — `BoundedSourceFeed`'s `handleCatch`.

`src/inbox/MergedList.tsx:996-1002` — the error card.

`src/ui/SectionCard.tsx:98-108` — an existing error slot, which is where a
retry affordance can hang.

**The bounded-retry precedent in this repo**: `src/inbox/useStableItems.ts:12`
(`MAX_CONSECUTIVE_ADOPTIONS`) — a cap on repeated adoption, for the same reason
a retry needs a cap here.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Relevant suites | `npx vitest run src/ui/ src/inbox/Inbox.test.tsx` | all pass |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/ui/SectionErrorBoundary.tsx`, `src/ui/SectionCard.tsx`
(retry affordance), `src/inbox/Inbox.tsx` and
`src/studio/inboxCountLayout.tsx` (pass a reset key), plus tests.

**Out of scope:**
- The observable-level recovery in `liveQuery$` — plan 063. This plan is about a **thrown render error**, which is a different failure.
- Removing the boundary or making it rethrow. Containment is correct; permanence is not.
- Plan 034's removed "Try again" button in the pane header. That was inert for a different reason (no refresh mechanism existed). A boundary reset is a remount, which genuinely does re-run the source — so it is not the same dead control. Say so in your commit message to avoid confusion.

## Git workflow

- Branch: `advisor/082-boundary-recovery`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Decide the reset trigger, and bound it

Add a bounded reset to `SectionErrorBoundary`:

```tsx
/**
 * Resets on a changed `resetKey`, at most `MAX_RESETS` times.
 *
 * Unbounded reset would reinstate the loop this boundary exists to contain: a
 * deterministic throw would remount, throw, remount forever. Bounded reset
 * turns a *transient* failure (a dropped listener, one 5xx) back into a
 * working source while still latching a real one — same trade-off as
 * `MAX_CONSECUTIVE_ADOPTIONS` in `useStableItems.ts`.
 */
```

Implementation: `componentDidUpdate` comparing `prevProps.resetKey`, clearing
`error` when it changes and the reset budget is not exhausted. Track resets in
state.

Choose the reset trigger deliberately and say why in your report. Candidates:
- an explicit user click ("Try again") — safest, no automatic loop at all
- a changed `resetKey` the parent bumps (e.g. on a manual refresh)
- a timer

**Recommendation**: the click, plus optional `resetKey`. An automatic timer
retry on a deterministic throw burns CPU invisibly, and this component sits in
an always-mounted layout.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Offer the retry where the error is shown

Use the existing error slot in `SectionCard` (`:98-108`) and the error card in
`MergedList` (`:996-1002`) to render a "Try again" control that bumps the
reset key.

**Verify**: `npx vitest run src/ui/ src/inbox/Inbox.test.tsx` → all pass.

### Step 3: Make the count provider recoverable too

`inboxCountLayout.tsx:140-148`'s boundary has no reset path and no UI to hang
one off — it is invisible plumbing behind a badge. Here a bounded automatic
reset is more defensible than a click (there is nothing to click), but it must
be **bounded and slow**.

Simplest honest option: allow N resets total for the tab's lifetime, triggered
by the same `resetKey` the pane uses when present, and otherwise leave it
latched. Do **not** add a polling timer to a component that lives as long as
the browser tab without measuring it.

State what you chose and why.

**Verify**: `npm test` → all pass.

## Test plan

New tests in `src/ui/` (extend `SectionCard.test.tsx` or create
`SectionErrorBoundary.test.tsx`):

1. A child that throws once then renders fine: after a reset, the children
   render. **The regression.**
2. A child that always throws: after `MAX_RESETS`, the fallback stays and no
   further remount attempts happen. Assert the child's render count stops
   growing — this is the loop guard.
3. `onCatch` fires once per catch, not once per render.
4. In `Inbox.test.tsx`: a source that throws once then recovers contributes
   rows again after retry.
5. Reset budget is per boundary instance, not global (two sources failing do
   not share a budget).

**Verify**: `npm test` → all pass, 5 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Test 2 confirms the reset is bounded (render count stops growing)
- [ ] Test 1 was confirmed to fail before the change
- [ ] Your report states the chosen trigger for both the pane and the count provider, with reasoning
- [ ] No timer was added to `inboxCountLayout` without a measurement
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Test 2 shows unbounded remounting. Stop: that is strictly worse than the
  current behaviour, because it burns CPU in an always-mounted layout.
- The reset requires the source's hooks to be re-created in a way that
  re-triggers a paid AI call. Nothing in a source's `useItems` should cost
  money, but verify — if a retry can bill the integrator, this plan needs a
  different design.
- You cannot distinguish "threw once" from "throws every render" in a test.
  Then the bound cannot be verified, and the plan should not ship.

## Maintenance notes

- The trade-off to preserve: **contain, then allow a bounded recovery.** An
  unbounded reset reinstates the crash; no reset makes a transient failure
  permanent. Both failure modes are worse than the middle.
- A reviewer should ask for test 2's render-count assertion specifically.
- Deferred: a real refresh mechanism for sources (Direction A in
  `plans/README.md`). A boundary reset remounts the feed, which is a blunt
  version of the same thing; if Direction A lands, this retry should route
  through it instead.
