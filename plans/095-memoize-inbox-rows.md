# Plan 095: Memoize inbox rows so the list can hold more

## Status

- **Priority**: P2
- **Effort**: M
- **Category**: performance
- **Depends on**: 094
- **State**: TODO. Found 2026-09-28 while sizing "Show more".

## The finding

`MergedList`'s `renderRow` passes each `InboxRow` fresh inline closures
(`onReassign`, `onUnassign`, `onSelectedChange`, a wrapped `onAssess`, …) on
every render, so every list render re-renders every row. Measured in jsdom:
about 1.3 ms per row, 45 ms at 20 rows, 132 ms at 100, 387 ms at 300. Any
report (a live refetch, debounced 500 ms per source) or a selection click
triggers one. This is why `MAX_LOADED_ROWS` is 200, not higher.

## Steps

1. Measure first, in a real browser (React Profiler), at 50/200 rows: how long
   a selection click and a live refetch take to commit.
2. Give `InboxRow` stable props. Handlers take the row key or item as an
   argument and come from `useCallback`s at list level, which read current
   state through refs, rather than closures made per row. `selected` stays
   a boolean prop.
3. Wrap `InboxRow` (with its `RowBoundary`) in `React.memo`. Check with the
   Profiler that a selection click re-renders one row, not all of them.
4. Re-measure, then raise `MAX_LOADED_ROWS` only as far as the numbers allow.

## Don't

- Don't write a custom `memo` comparator that ignores function props. That
  trades a slow render for stale closures acting on the wrong row.
