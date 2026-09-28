# Plan 093: The headline counts past each source's `limit`

## Status

- **Priority**: P1
- **Effort**: M
- **Category**: correctness
- **Depends on**: none
- **State**: DONE 2026-09-28 (branch `fix/headline-counts-past-limit`). Found the same day on a real Studio.

## The finding

"63 things waiting on you and your team" stayed at 63 while the maintainer fixed
about ten missing alt texts. The count was not stale. It counts the rows the pane
*loaded*, and every built-in source caps what it loads with `limit`
(`assetIssues` asks for `[0...$limit]` per image field, 20 by default). The source
live-refetches, so each fixed document made room for the next one from the dataset
and the row count stayed the same. The headline cannot move until a capped source
has fewer than `limit` findings left, which on a large dataset makes fixing things
look like it does nothing.

## Design

A new optional `InboxSourceResult.overflow: number`: how many further open items
matched but were left out of `items` by the source's own cap. It is a count, not
more rows. The list stays capped; only the number becomes honest.

- **Headline** (`Inbox.tsx` `openCount`) = the filtered open rows, as today, plus
  each main source's `overflow`, but only where the active filters can honestly
  include rows nobody has seen. The type filter is by source, so it applies
  exactly. The assignee and language filters depend on per-row data an unloaded
  row doesn't have, so while either is active, overflow is left out and the
  headline counts loaded rows only, as before.
- **Nav badge** (`useOpenCount` → `countOpenItems`) adds the same `overflow`, so
  the badge and the unfiltered headline keep agreeing per source (the invariant
  in `mergeItems.ts`).
- **Wiring**: `overflow` is data, not a capability, so it is excluded from
  `CapabilityKey` alongside `items`/`loading`/`error`, passed straight through,
  and listed in the report effect's dependencies directly (it is a primitive).

### Which sources can report it

Only where the capped query counts exactly what the rows are:

| Source | Overflow | How |
|---|---|---|
| `assetIssues` missing alt | yes | `count()` of the same filter, per field |
| `assetIssues` oversized | yes | `count()` of the same filter |
| `assetIssues` unused | yes, when scanned | `count()` of the same filter |
| `assetIssues` poor alt | **no** | "poor" is judged client-side after the fetch |
| `openTasks` open bucket | yes | `count()` of the same filter |
| `unpublishedDrafts` | yes, unless `onlyMine` | `count()`; `onlyMine` filters after the cap |
| `needsAttention` | yes | length before `slice(0, limit)` |
| `linkCheckerFindings` | yes | grouped findings before `slice(0, limit)` |
| `documentValidation` | **no** | a finding only exists after client-side validation |
| `unresolvedComments` | **no** (default `onlyMine`) | filters after the cap |

Sources that can't say leave `overflow` undefined and keep today's behaviour.

### Known approximation

A dismissal ("acknowledge") is per-editor state the dataset doesn't know about.
An acknowledged item that has fallen past the cap is still counted in `overflow`
until its document changes. The alternative (fetching every row to filter it)
is what `limit` exists to avoid.

## Verification

- Unit: `countOpenItems` adds overflow; the headline adds overflow only when
  no assignee/language filter is active and respects the type filter.
- Unit: `SourceFeed` passes `overflow` through and re-reports when it changes.
- Live: test Studio with more than `limit` missing-alt documents; fix one; the
  headline goes down by one.

## Outcome

Implemented as designed. Unit coverage for each of the verification bullets;
the `SourceFeed` re-report test was proven to fail with `overflow` removed from
the effect's dependency list. Every new GROQ count was run against the test
dataset and returned the expected numbers. **Not verified live in the pane**:
the test dataset has no source past its `limit` (4 assets, 3 drafts), and the
browser extension was not connected. Check on the real Studio: the headline
should read higher than 63, and drop by one per fixed alt text.
