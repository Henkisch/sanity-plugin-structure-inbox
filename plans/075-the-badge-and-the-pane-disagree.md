# Plan 075: Make the navbar badge count what the pane counts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **This plan has a design decision in Step 1.** Gather the evidence, then ask
> the maintainer. Do not pick for them — one route changes a `@public`
> interface on a published 2.x package.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/types.ts src/studio/inboxCountLayout.tsx src/inbox/mergeItems.ts src/inbox/splitItems.ts src/inbox/Inbox.tsx`
> On any mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — one route touches public API; the other approximates. Needs a decision before code.
- **Depends on**: none
- **Category**: bug + docs (a stale rationale in a `@public` doc comment)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

An editor clears five items. The pane says "3 things waiting". The navbar badge
the README tells consumers to build still says "8".

The badge is the always-visible number, so it is the one that will be believed.
And it never reaches zero for any source without a real `resolve` —
`unpublishedDrafts`, `documentValidation`, `linkCheckerFindings` — which is
most of them.

The cause is that `useOpenCount` takes no dismissals, and its doc comment
justifies that with something no longer true.

## Current state

**The public contract and its stale rationale** — `src/inbox/types.ts:614-618`:

```ts
useOpenCount?: (snoozes, now) => number | null
// No `dismissals` parameter: whether an item is open never depends on
// per-editor acknowledgement (see `splitItems.ts`'s own doc comment)
```

**Why that is no longer true** — `src/inbox/mergeItems.ts:109-128`: `mergeRows`
takes `dismissals` and pulls a non-stale-dismissed item *out of* `report.open`
and into the Cleared view, precisely for sources with no real `resolve`.
`src/inbox/splitItems.ts:16-20` acknowledges the split ("a separate axis this
function knows nothing about") — but `types.ts` still cites it as proof the
axis does not exist.

**The two divergent counts**:
- `src/studio/inboxCountLayout.tsx:88` and `:130-133` — the provider sums `source.useOpenCount?.(snoozes, now)`, no dismissal input.
- `src/inbox/Inbox.tsx:890-893` — the pane's headline derives from `rowsByView.open`, which **is** dismissal-filtered.

**The data is already there**: `src/studio/inboxCountLayout.tsx:111` holds the
shared `dismissals` instance. It just is not passed.

**Context**: `README.md:241-247` documents the navbar badge as a consumer
recipe, which is why this divergence is user-visible rather than internal.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | all pass |
| Build | `npm run build` | `[success]` |

## Scope

**In scope:** `src/studio/inboxCountLayout.tsx`, `src/inbox/types.ts`
(the stale comment at minimum), and — only if the maintainer picks route A —
the `useOpenCount` signature and its implementors.

**Out of scope:**
- `src/inbox/mergeItems.ts` and `src/inbox/splitItems.ts` — their behaviour is correct; the count provider is what is out of step.
- `src/inbox/Inbox.tsx`'s own headline — it is the correct number.

## Git workflow

- Branch: `advisor/075-badge-count`
- Conventional Commits. Route A is a `@public` signature change: if it is
  additive-optional it is `fix:`; if it forces implementors to change, `fix!:`
  with a `BREAKING CHANGE:` footer.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Establish which route is viable, then ask

**Route A — widen `useOpenCount`.** Add an optional third parameter carrying
dismissals. Optional keeps every existing implementor compiling, so it is
non-breaking. Gives an exact count.

**Route B — subtract in the provider.** Leave the public contract alone and
have `InboxCountLayout` subtract dismissed-and-not-stale entries. The catch:
the provider has the dismissal *record* but not each source's item ids, so
without them it can only approximate — it cannot tell whether a dismissed id is
still among that source's open items.

Determine, by reading `src/store/dismissals.ts` and
`src/studio/inboxCountLayout.tsx`, whether route B can be made exact. State the
answer with evidence.

**Verify**: your report recommends a route with the reasoning, and the
maintainer has chosen.

### Step 2: Implement the chosen route

Route A: add the parameter as optional, thread `dismissals` through from
`inboxCountLayout.tsx:111`, and update the built-in implementors to use it.

Route B: subtract in the provider, and **document the approximation honestly**
in the code comment — an approximate badge is defensible, an approximate badge
presented as exact is not.

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 3: Fix the stale rationale

Rewrite `types.ts:614-618`'s comment so it describes reality: dismissals *are*
an axis that affects openness for sources without a real `resolve`
(`mergeItems.ts:109-128`), and say how the count handles it after Step 2.

**Verify**: `grep -n "never depends on" src/inbox/types.ts` → no matches.

## Test plan

New tests in `src/studio/` (create a test file for `inboxCountLayout` if none
exists — check first):

1. **The regression**: a source reporting 8 open items, 5 of them dismissed and
   not stale → the provider reports 3, matching the pane. Before this plan it
   reports 8.
2. A dismissal that has gone **stale** (past its TTL) does not reduce the
   count — stale dismissals return the row to Open, per `mergeRows`.
3. A source with a real `resolve` is unaffected.
4. Two sources with overlapping item ids do not cross-subtract (the dismissal
   record is namespaced by source name — confirm and assert it).

**Verify**: `npm test` → all pass, 4 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] The maintainer's chosen route is recorded in your report
- [ ] Test 1 was confirmed to fail before the change
- [ ] `grep -n "never depends on" src/inbox/types.ts` → no matches
- [ ] If route A: `useOpenCount`'s new parameter is optional, and `etc/*.api.md` (if plan 067 has landed) shows the signature change deliberately
- [ ] If route B: the approximation is documented in a code comment
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Route B cannot be made exact and the maintainer wants exactness. Then route A
  is the only option and it touches public API — confirm before coding.
- Threading dismissals into the count provider introduces a new subscription
  that re-renders the always-mounted layout frequently. That layout lives as
  long as the browser tab; a per-keystroke re-render there is worse than a
  wrong badge. Measure and report.
- You find a third count somewhere else that also disagrees. Report it.

## Maintenance notes

- The invariant: **the badge and the pane headline must derive from the same
  definition of "open".** They diverged because one grew a dismissal axis and
  the other did not. A reviewer should ask whether both paths were updated
  whenever openness logic changes.
- `inboxCountLayout` is mounted at `studio.components.layout` and lives for the
  whole tab — be conservative about what it subscribes to.
- Deferred: `useOpenCount` returning `null` (meaning "cannot determine") is
  untouched here; check how it interacts with subtraction in route B.
