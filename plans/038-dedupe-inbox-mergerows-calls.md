# Plan 038: `Inbox.tsx` computes `mergeRows` for the same view more than once

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/inbox/Inbox.tsx src/inbox/mergeItems.ts`
> If either changed since this plan was written, re-read `Inbox.tsx`'s lines
> around `allRowsAnyView`/`openRows`/`snoozedRows` and compare against the
> excerpts below — line numbers may have shifted.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: performance
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`Inbox.tsx` calls the pure function `mergeRows(reports, mainOrder, view,
dismissals.state)` **five times** today to cover only **three** distinct
views (`'open'`, `'cleared'`, `'snoozed'`):

- `allRowsAnyView` (used for the filter bar's assignee/type chip lists)
  calls it three times via `flatMap` — once per view — then immediately
  flattens the results together, discarding which view each row came from.
- `openRows` calls it a **fourth** time, for `'open'` again — a value
  `allRowsAnyView`'s own flatMap already computed and then threw away.
- `snoozedRows` calls it a **fifth** time, for `'snoozed'` again — same
  redundancy.

All five calls share the identical `useMemo` dependency array (`[reports,
mainOrder, dismissals.state]`, give or take `view`'s own fixed value per
call site), so they all recompute together, on the same renders, every
time. Two of those five calls do work `allRowsAnyView` already did one
line earlier. `mergeRows` walks every source's every reported item and
sorts the result (`compareMergedRows`) — not free, and this repeats it for
no reason on every dismissal/report change.

This plan is scoped to `Inbox.tsx`'s own internal redundancy only. A
related, larger redundancy — `MergedList.tsx` independently calling
`mergeRows` a **sixth** time from raw `reports`/`order`/`dismissals` props,
for whichever view is currently active — is a separate, bigger change (it
would mean changing `MergedList`'s own prop contract to accept precomputed
rows instead of raw inputs, touching its test suite and its standalone
usability). That's recorded as a follow-up in this plan's own Maintenance
notes, not undertaken here.

## Current state

- `src/inbox/Inbox.tsx:481-487` (`allRowsAnyView` — three `mergeRows` calls
  via `flatMap`, one per view, immediately flattened together):
  ```ts
  const allRowsAnyView = useMemo(
    () =>
      (['open', 'cleared', 'snoozed'] as const).flatMap((v) =>
        mergeRows(reports, mainOrder, v, dismissals.state),
      ),
    [reports, mainOrder, dismissals.state],
  )
  ```
- `src/inbox/Inbox.tsx:581-584` (`openRows` — a fourth call, duplicating
  the `'open'` case `allRowsAnyView` already computed):
  ```ts
  const openRows = useMemo(
    () => mergeRows(reports, mainOrder, 'open', dismissals.state),
    [reports, mainOrder, dismissals.state],
  )
  ```
- `src/inbox/Inbox.tsx:589-592` (`snoozedRows` — a fifth call, duplicating
  the `'snoozed'` case):
  ```ts
  const snoozedRows = useMemo(
    () => mergeRows(reports, mainOrder, 'snoozed', dismissals.state),
    [reports, mainOrder, dismissals.state],
  )
  ```
- `src/inbox/mergeItems.ts:5-31` — `MergedRow`'s own shape has no field
  naming which view produced it (confirmed: `key`/`sourceName`/`item`/
  `clearedBy`/`clearedAt` only) — today's `flatMap`-then-discard approach
  in `allRowsAnyView` is exactly why: once flattened, there's no way back
  to "just the open ones" without either tagging each row with its view or
  keeping the three arrays separate before flattening. This plan does the
  latter.
- `allRowsAnyView` is consumed downstream by `availableAssignees` (line
  494-510), `hasUnassignedRow` (515-518), and `availableTypes` (547-552) —
  all of which only need the flattened, order-independent union across all
  three views. Nothing downstream needs to know which view a row in
  `allRowsAnyView` itself came from.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/Inbox.tsx` (`allRowsAnyView`, `openRows`, `snoozedRows` only)

**Out of scope**:
- `src/inbox/mergeItems.ts` — `mergeRows`/`MergedRow` themselves are
  unchanged; this plan only changes how many times `Inbox.tsx` calls the
  existing function.
- `src/inbox/MergedList.tsx` — its own independent `mergeRows` call stays;
  see "Why this matters" above and this plan's own Maintenance notes for
  why that's a separate, bigger change.
- Any other `useMemo` in `Inbox.tsx` beyond these three.

## Git workflow

- Commits land directly on `main`. Message style: `perf: stop computing
  mergeRows for the same view more than once in Inbox.tsx`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Compute each view exactly once, keyed by view

Replace the three declarations with one `useMemo` that computes all three
views' rows once each, keeping them separate, plus two derived `useMemo`s
that read from it instead of recomputing:

```ts
const rowsByView = useMemo(() => {
  const views = ['open', 'cleared', 'snoozed'] as const
  const result = {} as Record<InboxView, MergedRow[]>
  for (const v of views) {
    result[v] = mergeRows(reports, mainOrder, v, dismissals.state)
  }
  return result
}, [reports, mainOrder, dismissals.state])

// Every main-source row across *all three* tabs, not just whichever one is
// currently selected — used only to decide which filter chips exist, never
// to decide what's shown. (Same reasoning comment as before — keep it.)
const allRowsAnyView = useMemo(
  () => [...rowsByView.open, ...rowsByView.cleared, ...rowsByView.snoozed],
  [rowsByView],
)
```

Then replace the `openRows`/`snoozedRows` declarations with plain reads —
no new `mergeRows` call, no new `useMemo` needed for either (they're
already memoized once, inside `rowsByView`):

```ts
const openRows = rowsByView.open
const snoozedRows = rowsByView.snoozed
```

Keep every existing comment that explained *why* `openRows`/`snoozedRows`
exist as their own named values (the "fixed to the `open` view regardless
of which tab is selected" comment, and the "feeds `InboxStats`'s own
`nextWake`" comment) — move them to sit next to these new plain
declarations rather than deleting them; the reasoning they capture is still
true and still non-obvious.

Import `type MergedRow` from `./mergeItems` if not already imported in this
file (check first: `grep -n "from './mergeItems'" src/inbox/Inbox.tsx`).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

No new test needed — this is a pure internal refactor with no behavior
change (the three resulting values, `allRowsAnyView`/`openRows`/
`snoozedRows`, are identical in content to what they were before; only how
many times `mergeRows` runs to produce them changes). The existing test
suite (`Inbox.test.tsx`, `mergeItems.test.ts`, `MergedList.test.tsx`) is
the regression guard — if the pane still renders the same rows/counts/
filter chips, the dedup didn't alter behavior.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, no new failures
- [ ] `npm run build` exits 0
- [ ] `grep -n "mergeRows(" src/inbox/Inbox.tsx` shows exactly one call
      site (inside the new `rowsByView` computation), not five
- [ ] No files outside `src/inbox/Inbox.tsx` are modified (`git status`)
- [ ] `plans/README.md` status row for 038 updated

## STOP conditions

- `allRowsAnyView`'s current three-way `flatMap` order matters to some
  downstream consumer in a way this plan's excerpt didn't capture (e.g. if
  `availableAssignees`'s "viewer's own chip leads" sort, or any other
  downstream logic, secretly depends on cross-view ordering rather than
  just membership) — re-read every consumer of `allRowsAnyView` before
  assuming simple concatenation (`[...open, ...cleared, ...snoozed]`)
  preserves what `flatMap(v => mergeRows(...))` over the same view order
  produced. They should be identical (concatenation in the same view
  order is exactly what `flatMap` over an ordered array already does),
  but confirm rather than assume if anything downstream looks order-
  sensitive beyond what's quoted above.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

`MergedList.tsx:185-188` still calls `mergeRows(reports, order, view,
dismissals.state)` independently, from the same raw `reports`/`order`/
`dismissals` `Inbox.tsx` already has fully-computed rows for (via
`rowsByView[view]` after this plan). Passing `rowsByView[view]` down as a
new `rows` prop instead of `reports`/`order` would remove that last
redundant call too, but changes `MergedList`'s own prop contract (it is
also rendered/tested standalone in `MergedList.test.tsx` with its own
`reports`/`order`/`dismissals` props) — a real, contained follow-up, not
done in this plan to keep this one a pure, zero-risk internal dedup.
