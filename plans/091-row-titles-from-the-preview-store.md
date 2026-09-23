# Plan 091: Row titles from the Studio preview store

## Status

- **Priority**: P3
- **Effort**: M–L
- **Category**: feature / fidelity
- **Depends on**: 089
- **State**: DEFERRED (scoped 2026-09-23, not started)

## Idea

Resolve a document row's title through the Studio preview store
(`useDocumentPreviewStore` / `unstable_useValuePreview`). A row would then read exactly
what the editor sees in document lists, including a custom `preview.prepare()` that
already localizes or composes a title. `toDisplayTitle` stays as the value while the
preview loads, and as the fallback if it fails.

## Why deferred

- **Subscriptions:** one preview-store subscription per visible row. The list is capped
  by `limit`, but the count is still sources × limit.
- **Identity churn:** a preview arriving would change `item.title` after the report, so
  it has to update the row, not the source's result. Otherwise it breaks the AGENTS.md
  identity-churn invariant (the fourth time that would have bitten). The likely shape
  is a `useRowTitle(item)` inside `InboxRow`, keyed on `intent.params.id`/`type`, that
  never feeds back into `SourceFeed`.
- **Not needed for the crash:** 089's field-level read already covers the reported
  crash and the common shapes.

## Also parked here

- **`resolveTitle?: (doc) => string | null`:** an integrator escape hatch. It widens
  the public API for an unproven need, and this plan is the better answer to custom
  title shapes.
