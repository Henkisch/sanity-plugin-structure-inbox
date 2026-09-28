# Plan 094: "Show more" past each source's `limit`

## Status

- **Priority**: P2
- **Effort**: M
- **Category**: feature
- **Depends on**: 093 (`overflow`)
- **State**: DONE 2026-09-28 (branch `feat/load-more`, stacked on 093).

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
