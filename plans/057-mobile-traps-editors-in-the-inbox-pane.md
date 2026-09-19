# Plan 057: The Inbox pane traps editors on mobile

> **Record, not a spec.** Unlike most files here, this one was written *after*
> the fix, from a bug reported live against a real Studio on a phone. It keeps
> the reasoning that a future reader will need — especially the constraint that
> forced a public API removal — rather than steps to execute.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MEDIUM (breaking API change)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b13092f`, 2026-09-19

## Why this matters

On a phone, the plugin made **the entire rest of the Studio's structure
unreachable**. Not degraded — unreachable. Reported from a real Studio, with
screenshots: a stock Studio opens the root list (Home, Pages, Articles,
Authors, Site Configuration); with this plugin installed, the same URL opened
the Inbox and nothing else, with no back button and no list to return to.

Four things combined, each defensible on its own:

1. `createActiveToolLayout` redirects a bare landing to
   `panes: [[{id: INBOX_PANE_ID}]]`.
2. The structure tool collapses its pane layout below `theme.sanity.media[1]`
   (640px) and renders **only the last pane** — every pane to its left is in
   the DOM but hidden. So the root list was resolved, just invisible.
3. The Inbox node deliberately has no `.title()`, and `UserComponentPane`
   renders no pane header for a titleless component pane — which is *why* there
   was no back button. On a wide layout this is a win (the root list sits right
   beside the pane; a bar repeating "Inbox" costs vertical space for nothing).
4. `showInList` defaulted to `false`, so there was no root-list entry either.

The redirect used `replace: true`, so browser Back had nothing to return to
either. Every exit was closed at once.

## The constraint that shaped the fix

A structure is serialized **once**, before any viewport is known, and is not
re-resolved on resize. So the Inbox's list entry cannot be added for narrow
screens alone — it is in the list for everyone, or for no one.

That is what made `showInList` untenable rather than merely mis-defaulted:
once the redirect stops firing on a collapsed layout, the list entry is the
*only* way into the Inbox on a phone, and an option whose off-state produces a
broken Studio is not a real choice. Flipping its default to `true` was
considered and rejected for that reason — it would have left a supported
config that silently breaks mobile, guarded by nothing but a console warning.

## What shipped

| Change | File |
| --- | --- |
| `useCollapsedLayout()` — `useMediaIndex() < 2`, the tool's own `width < media[1]` rule expressed against the viewport, readable from outside the structure tool's providers (`activeToolLayout` wraps the tool, so `useStructureTool()`'s authoritative `layoutCollapsed` is not in scope there) | `src/studio/useCollapsedLayout.ts` (new) |
| `collapsedLayout` gate — the redirect never fires below 640px, regardless of `redirectOnLanding`. Editors land on the root list, like a stock Studio | `src/studio/shouldRedirectToInbox.ts` |
| The Inbox entry is always added to the root list; a hand-placed `inboxListItem` is detected by id and not duplicated | `src/structure/wrapStructure.ts` |
| `CollapsedBackBar` — a sticky back bar rendered only when `layoutCollapsed`, so a deep link or bookmark straight to the pane is not a dead end either. Sticky because `UserComponentPaneContent` is the scroll container; a static bar would scroll away above hundreds of rows | `src/structure/InboxPane.tsx` |
| `showInList` removed from `StructureInboxConfig` | `src/types.ts`, `src/structure/resolveConfig.ts` |

Also: the extendability check in `wrapStructure` moved *above* the list-item
insertion. An observable root previously warned twice — once about having no
list to add an entry to, once about being unextendable — and the first buried
the one that mattered.

`inboxListItem(S)` remains the supported way to control *where* the entry sits.

## Breaking change

`showInList` is gone from the public config type. A Studio passing it gets a
TS error; a Studio that had `showInList: false` now gets the entry. Released as
**2.0.0**.

The package was two days old (1.0.5, first published 2026-09-17), which is why
a major was cheap enough to prefer over keeping a deprecated no-op.

## Verification

- 473 unit tests, typecheck, and lint clean.
- Confirmed live on a real phone against `test-studio` over LAN
  (`sanity dev --host 0.0.0.0`, CORS origin added for the machine's LAN
  address): lands on the root list, Inbox entry at the top above the divider,
  back bar returns to the root list, desktop behaviour unchanged.

## Notes for whoever is here next

- `npm run format` (oxfmt) reformats ~110 files that are committed in a
  different style. It was run during this work and the churn reverted by hand.
  Either fix the repo's formatting in one deliberate commit or stop running it.
- The 640px threshold is Sanity's, not ours: `StructureTool` passes
  `minWidth={media[1]}` to `PaneLayout`, which sets `collapsed = width <
  minWidth`. `useCollapsedLayout` derives the same number from the theme rather
  than hardcoding it, so a custom theme's breakpoints stay authoritative.
