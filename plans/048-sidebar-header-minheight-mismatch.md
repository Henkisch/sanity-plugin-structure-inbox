# Plan 048: Two stacked sidebar card headers claim to match but render 4px apart

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/ui/SectionCard.tsx src/inbox/InboxStats.tsx src/inbox/MergedList.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

The sidebar column stacks two visually-identical card headers directly on
top of each other: `InboxStats`'s "Overview" card, then (below it) any
`aside`-placed source's own `SectionCard`-rendered card (e.g. "Upcoming
releases"). Both use the same border/padding/tone header treatment and are
clearly meant to look like one consistent family of cards. They don't:
`SectionCard`'s header is pinned to `minHeight: 58`, `InboxStats`'s to
`minHeight: 54` — a visible 4px seam between two stacked cards that
otherwise look identical. Confirmed live in a running Studio (not just from
source): `SectionCard`'s header renders at 58px, `InboxStats`'s at 54px,
exactly as coded — this is a real, reproducible visual mismatch, not a
theoretical one.

Each of the three relevant call sites' own doc comments claims to match
one of the *other* two, but the actual numbers don't reconcile:
`SectionCard` (58) says it matches `MergedList`'s actions/toolbar row —
which in fact sets no `minHeight` at all today, so that comparison target
doesn't currently exist as stated. `InboxStats` (54) says it matches
`SectionCard` — it doesn't (58 ≠ 54); it actually matches a *different*
row in `MergedList` (the filter/checkbox row, which itself also claims to
match `SectionCard`'s header). The whole chain of "confirmed live" claims
no longer points at a single, checkable source of truth, so the next
person to touch any one of these three numbers has no way to know they've
broken the claimed equivalence again.

## Current state

- `src/ui/SectionCard.tsx:46-68` — current code (comment + the pinned row):
  ```tsx
  // `minHeight` matches `MergedList`'s own actions/toolbar row
  // ... [comment continues, claims equivalence with MergedList's
  // actions/toolbar row — see Step 1 below for why that claim is stale] ...
  style={{alignItems: 'center', display: 'flex', minHeight: 58}}
  ```
  Confirmed live (via a running `test-studio` instance): this card's header
  renders at exactly 58px.

- `src/inbox/InboxStats.tsx:195` — current code:
  ```tsx
  style={{alignItems: 'center', display: 'flex', minHeight: 54}}
  ```
  This is the "Overview" card's own header row, inside a `Card` with
  `borderBottom paddingX={3} paddingY={3} radius={0} tone="transparent"`
  (same shape `SectionCard`'s header uses). Confirmed live: renders at
  exactly 54px — 4px shorter than `SectionCard`'s header, directly above
  or below it in the same sidebar column depending on source order.

- `src/inbox/MergedList.tsx:1013-1018` — the row that actually carries
  `minHeight: 54` in `MergedList.tsx` (the checkbox/filter bar, **not**
  the actions/toolbar row `SectionCard`'s comment references):
  ```tsx
  <Card
    borderBottom
    paddingX={3}
    paddingY={3}
    radius={0}
    style={{containerType: 'inline-size', minHeight: 54}}
  >
  ```
  Its own doc comment (directly above, `MergedList.tsx:996-1012`) says:
  "Matches the header every `aside` source's own card already has
  (`SectionCard`) ... `minHeight` (measured live: the filter bar's own row
  rendered at 54px..." — i.e. *this* row's comment also claims to match
  `SectionCard`, at 54, which contradicts `SectionCard`'s real, live value
  of 58.

- `src/inbox/MergedList.tsx`'s actions/toolbar row (`actions && (...)`
  block, a few lines above the filter/checkbox row above) — the row
  `SectionCard`'s own comment claims to match — sets **no** `minHeight` at
  all today; it sizes to its natural content height.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run`      | all pass             |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope** (the only files you should modify):
- `src/inbox/InboxStats.tsx` (change its header `minHeight` to match
  `SectionCard`'s real value)
- `src/ui/SectionCard.tsx` (fix its own doc comment's stale comparison
  target — see Step 2; do not change its `minHeight: 58` value itself,
  since that is the one already confirmed live and is the value the fix
  standardizes on)
- `src/inbox/MergedList.tsx` (fix the filter/checkbox row's doc comment
  only — see Step 2; its own `minHeight: 54` value is correct for *that*
  row and stays as-is, since it is a different, independently-tuned row
  that happens to share a number with the old, wrong `InboxStats` value by
  coincidence, not by design)

**Out of scope**:
- Do NOT change `MergedList.tsx`'s filter/checkbox row's actual
  `minHeight: 54` value — it is correctly tuned for that row's own content
  (the filter bar/selection bar it swaps between) and is unrelated to the
  sidebar-header mismatch this plan fixes.
- Do NOT add a `minHeight` to `MergedList`'s actions/toolbar row — that row
  intentionally sizes to content (per its own doc comment, "a variable-
  width button cluster" needs to be able to grow); pinning it is a
  separate, unrelated change not requested here.
- Do NOT introduce a new shared spacing constant/token system across the
  whole file (e.g. a `SIDEBAR_HEADER_HEIGHT` exported from a shared
  module) unless a later plan asks for one — for this fix, just make the
  two numbers agree and correct the comments; don't build new
  infrastructure.

## Git workflow

- Branch: `advisor/048-sidebar-header-minheight`
- One commit: `fix: match InboxStats' header height to SectionCard's real, confirmed-live value`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Change `InboxStats.tsx`'s header `minHeight` from 54 to 58

In `src/inbox/InboxStats.tsx:195`, change `minHeight: 54` to `minHeight:
58`, matching `SectionCard.tsx`'s own, live-confirmed value exactly.
Update the doc comment above this line (if any references the old value)
to state the real, current fact: "Matches `SectionCard`'s own header
`minHeight` (58px, confirmed live in a running Studio) so the two stacked
sidebar cards' headers align."

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Fix the two stale "confirmed live"/comparison comments

- In `src/ui/SectionCard.tsx`, its header comment currently claims to
  match "`MergedList`'s own actions/toolbar row" — that row has no
  `minHeight` today, so the comparison target doesn't exist as stated.
  Rewrite the comment to state what is actually true: this value (58) is
  this card's own tuned header height, and `InboxStats`'s header now
  matches it (not the other way around, and not `MergedList`'s toolbar
  row).
- In `src/inbox/MergedList.tsx`, the filter/checkbox row's comment
  (around lines 996-1012) currently claims its `minHeight: 54` "matches
  the header every aside source's own card already has (`SectionCard`)" —
  this is the specific claim that was wrong (`SectionCard` is 58, not 54).
  Rewrite this to remove the incorrect equivalence claim: state plainly
  that 54px is this row's own measured value (filter bar/selection bar),
  unrelated to `SectionCard`'s header height, which is a different number
  for a different row.

**Verify**: read both edited comments back and confirm neither one still
asserts a numeric equivalence that isn't true after Step 1. `npm run lint`
→ exit 0.

## Test plan

This is a pure visual-constant change with no behavioral branch to unit
test meaningfully beyond typechecking (a `minHeight: 58` vs `54` numeric
literal isn't something a DOM-diffing test asserts well). Instead:

- Run the full existing test suite to confirm nothing snapshot-asserts the
  old `54` value anywhere: `npx vitest run` → all pass, no failures
  referencing `InboxStats.tsx`'s header row.
- `grep -rn "minHeight: 54" src/inbox/InboxStats.tsx` → no matches
  (confirms the value actually changed).
- If a live Studio (`test-studio/`) is available to the executor
  environment, visually confirm in the browser that the "Overview" card's
  header and the next `aside` source's card header now align exactly (no
  visible seam). If no live environment is available, note this in the
  final report as unverified rather than skipping the check silently.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0, no new failures
- [ ] `npm run build` exits 0
- [ ] `grep -rn "minHeight: 54" src/inbox/InboxStats.tsx` returns no matches
- [ ] Both doc comments (in `SectionCard.tsx` and `MergedList.tsx`) no
      longer assert a numeric equivalence that isn't true
- [ ] `git status` shows only `src/inbox/InboxStats.tsx`,
      `src/ui/SectionCard.tsx`, and `src/inbox/MergedList.tsx` changed
- [ ] `plans/README.md` status row for plan 048 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the three cited `minHeight` values doesn't match what's in this
  plan (drift since it was written) — re-measure live if possible before
  assuming which number is "correct."
- Changing `InboxStats.tsx`'s `minHeight` to 58 visibly breaks its own
  internal layout (e.g. the "Overview" title no longer vertically centers,
  or the card grows unexpectedly on narrow viewports) — report this rather
  than force-fitting a different fix.
- You find a fourth call site elsewhere in the codebase also claiming to
  match one of these two headers with yet another number — report it
  rather than silently reconciling it into this plan's scope.

## Maintenance notes

- If a future refactor introduces a shared spacing-constants module for
  this plugin (a real, previously-flagged direction — see
  `plans/README.md`), `58` (this plan's canonical value) is the number to
  export as the sidebar-header-height constant, since it's the one
  confirmed live and now shared by both call sites.
- A reviewer should specifically look at the sidebar column in a Studio
  with at least one `aside`-placed source configured (e.g.
  `upcomingReleases`) to see both headers stacked and confirm the seam is
  gone.
