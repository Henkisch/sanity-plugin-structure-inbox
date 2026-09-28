# Plan 096: Rows as real links, so cmd+click opens a new tab

## Status

- **Priority**: P2
- **Effort**: S
- **Category**: ux
- **Depends on**: —
- **State**: DONE 2026-09-28 (branch `feat/row-links`). Not verified live yet.

## The finding

A row with an `intent` navigated from the card's `onClick` only. With no
`href`, cmd/ctrl-click, middle-click and "Open link in new tab" did nothing
useful, so an editor couldn't fix something in another tab and come back to
the inbox where they left it.

## What shipped

- `InboxRow` lays a real `<a href>` (`RowAnchor`, from `resolveIntentLink`)
  over the whole card. The row can't *be* the link: it holds its own
  `<button>`s. The checkbox, assignee picker, three-dot menu and fix row sit
  above it (`RAISED`).
- A plain left click still calls `navigateIntent`, same as before. Any
  modified or non-left click is left to the browser.
- `resolveIntentLink` throws when the router has no route for the intent.
  The row then renders no link and keeps click-only navigation instead of
  crashing.
- Keyboard users can now Tab to a row and press Enter.
- Rows without an intent can bring their own URL (`InboxItem.href`). A
  new-tab click calls `openDetail(item, {newTab: true})` so side effects still
  run while the browser handles the navigation.
  - Oversized/unused asset rows link to the media tool's root (the filename
    still goes to the clipboard), or to the file when there's no media tool.
    No link when the integrator supplies `openAsset`.
  - Tasks with no target document link to `?sidebar=tasks&viewMode=edit&selectedTask=<id>`,
    the same URL Sanity's own "Copy link to task" builds.
  - The media tool path now strips a trailing slash from `basePath`, so a
    root workspace no longer builds `//media`.

## Not done

Todos open an edit dialog and have no URL, so they stay click-only.

## Verify live

cmd+click, middle-click, right-click → new tab on the document, inbox tab
unchanged. Plain click unchanged. Checkbox, avatar, ⋯ and fix buttons still
work, and hover background still shows. Check aside rows too.
