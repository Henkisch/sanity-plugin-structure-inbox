# Plan 094: "Show more" past each source's `limit`

## Status

- **Priority**: P2
- **Effort**: M
- **Category**: feature
- **Depends on**: 093 (`overflow`)
- **State**: DONE 2026-09-28 (branch `feat/load-more`, stacked on 093), revised the same day (see the end of this file).

## Why

093 made the headline count what each source left out. The list itself still
stopped at `limit` with nothing to say so. That is fine for triage, but not for
working through everything in one sitting, like every missing alt text.

## Design

- **`InboxSourceResult.loadMore?: () => void`**: a capability, wired into
  `SourceFeed` in the three usual places (the `CapabilityKey` guard caught the
  test fixture, as intended).
- **`usePagedLimit(limit)`** (`sources/pagedLimit.ts`): session state. Each call
  adds one page (the configured `limit`). Capped at `MAX_PAGED_LIMIT` (200) per
  query, since `assetIssues` runs one capped query per check per field.
  `loadMore` is stable and becomes `undefined` at the ceiling.
- **Holding rows** (`SourceFeed`): a source pages by rebuilding its query, which
  starts over from `{items: [], loading: true}`. Between the click and the next
  settled result, the last settled rows are held and reported with
  `loading: false, loadingMore: true`, so the list never collapses to
  "Loading…". It settles when the source is seen loading and then not, when
  rows or overflow change (sources that page synchronously), or after 20 s.
  A second click while a page is on its way is ignored.
- **Footer** (`LoadMoreFooter`): Open view only, one button for the whole list.
  The list is merged and time-sorted, so a new page lands throughout it, and a
  per-source button would look inert. The "N more not shown" count uses the
  same rule as the headline: exact under the type filter, but under an assignee
  or language filter it can't give a number and says so. The button is still
  offered then. At the ceiling it keeps the count and says to clear some.
  - When every loaded row is dismissed, snoozed or filtered away but more
    exist, the footer replaces "Nothing open.", which would be false.

## Per source

| Source | Pages | Notes |
|---|---|---|
| `assetIssues` | every capped query at once | oversized projection's reference lookups now bounded by 200, not 20 |
| `openTasks` | open bucket only (`$openLimit`) | recently closed keeps `limit` |
| `unpublishedDrafts` | yes, not with `onlyMine` | `onlyMine` has no `overflow` |
| `needsAttention` | client-side re-slice | |
| `linkCheckerFindings` | client-side re-slice | report subscription no longer rebuilt per page |
| `documentValidation`, `unresolvedComments`, poor alt | no | no exact `overflow` |

## Not done

- Paging the aside column (`InboxSection`). Nothing there reports `overflow`
  today except `unpublishedDrafts` placed aside.
- Persisting pages in the pane URL. It's session state on purpose.

## Verification

Unit coverage: `usePagedLimit`; `summarizeMore`; the footer in `MergedList`
(offer, click fans out, hidden when complete, replaces the empty state, at the
ceiling, Open view only); `SourceFeed` hold, double click, sync source and timeout. The hold test was
proven to fail with the hold removed. `assetIssues` re-queries at `limit: 2`
after one click. **Not verified live**: the browser extension was not connected.

## Revision 2026-09-28: page size from research, and a row budget

The first version paged by each source's own `limit` (10 for tasks, 20 per
asset check), so clearing a real backlog took many clicks, and one click
could add 10 rows or 100+. Reworked after reading the research:

- **Baymard** (product lists): pages much smaller than 50 slowed scanning with
  repeated loads, and the desktop sweet spot was 50–150.
  https://baymard.com/blog/number-of-items-loaded-by-default
- **NN/g**: show total, loaded and remaining ("Viewing 40 of 333"), and replace
  the button with the total once everything is loaded.
  https://www.nngroup.com/articles/alternatives-pagination-listing-pages/ ;
  goal-driven lists need a visible end:
  https://www.nngroup.com/articles/infinite-scrolling/

Neither studies a work queue, and neither gives a per-click number, so the
constants are judgement calls, one line each in `sources/pagedLimit.ts`:

- `PAGE_SIZE = 50`: one list-wide step, split across sources in proportion to
  what each has left (`allocate`, largest remainder), so the button's number
  is exactly what loads. `loadMore(count)` now takes that count.
  `assetIssues` splits its own share across its checks the same way.
- `SHOW_ALL_THRESHOLD = 100`: "Show all 44" when that's everything left.
- `MAX_LOADED_ROWS = 200` across the whole list, which is also the per-query
  ceiling. Rows aren't memoized, so every loaded row re-renders on every list
  render. Measured in jsdom: ~1.3 ms per row (45 ms at 20, 387 ms at 300).
  200 is close to what a default config can already load on first open.
- Footer reads "Showing 19 of 63" and the button says what it does.
