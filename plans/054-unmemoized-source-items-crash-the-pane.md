# Plan 054: An unmemoized source's `items` take the whole Structure tool down

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9a89176..HEAD -- src/inbox/SourceFeed.tsx src/inbox/Inbox.tsx`
> If either changed since this plan was written, re-read it before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `9a89176`, 2026-09-18

## Why this matters

A customer installed `1.0.3` into their own Studio and the Structure tool
crashed outright with React's **"Maximum update depth exceeded"**. The Inbox
list item rendered; opening it killed the pane.

Their Studio registered one hand-written source whose `useItems` ended in
`items: rows.map(toItem)` — a new array of new objects on every render. That is
the exact pattern this plugin's own README taught under "Writing your own", so
the bug is the plugin's, not theirs.

The loop:

1. `SourceFeed` memoizes `splitItems(items, …)` on `[items, …]`, so a new
   `items` identity produces new `open`/`cleared`/`snoozed` arrays.
2. Those three are in the report effect's dependency list, so it re-fires and
   calls `onReport`.
3. `Inbox.handleReport` stored every report as `{...current, [name]: report}` —
   a new object unconditionally, so it always re-rendered.
4. The re-render calls `useItems()` again → new `items` → back to 1.

Every built-in source dodged this by memoizing or emitting through an
observable. Nothing tested the unmemoized case: `SourceFeed.test.tsx` passed one
hoisted `result` object.

The repo already knew. `src/inbox/Inbox.test.tsx` carried a comment saying a
fresh `{items: []}` per call caused "Maximum update depth exceeded", *confirmed
live* — and the fix at the time was to hoist a constant **in the test**.
`SourceFeed.tsx` carries a second comment about the same class of loop via
`assign`'s identity, fixed with a fingerprint dependency list. The `items` axis
was left on raw identity both times.

## What changed

1. **`src/inbox/useStableItems.ts`** (new) — `sameItems` compares two item lists
   by content (recursing into `intent`, comparing `icon` and other functions by
   identity), and `useStableItems` returns the previous array while the content
   is unchanged. `SourceFeed` routes `result.items` through it, so an
   unmemoized source costs nothing.
2. **`src/inbox/Inbox.tsx`** — `handleReport` keeps the same `reports` object
   when `sameReport` says nothing changed, matching the guard
   `createInboxCountLayout`'s own `handleCount` has always had.
3. **`src/inbox/sources/needsAttention.ts`, `upcomingReleases.ts`** — their
   "Releases unavailable" branch built a fresh `[]` **and a fresh `Error`** on
   every render, which is the same loop through the `error` dependency rather
   than `items` (and one `useStableItems` does not cover). Both hoisted to a
   module-scope `RELEASES_UNAVAILABLE` constant.
4. **Docs** — the README example now memoizes and says why;
   `InboxSourceResult.items` documents it; `AGENTS.md` records the invariant
   for the whole class, since this has now bitten three times.
5. **`test-studio/unmemoizedCanary.ts`** (new) — a deliberately unmemoized
   source, registered in that workspace, so the case that crashed a customer is
   exercised somewhere by default.

## Done criteria

- `src/inbox/useStableItems.test.ts` covers `sameItems` and the hook.
- `SourceFeed.test.tsx` renders a churning source under a memoized, always-
  storing parent and asserts exactly one report. **Verified to fail without the
  fix** — it exhausts the heap rather than merely failing an assertion.
- `Inbox.test.tsx` renders a churning source through the real `Inbox` and
  asserts the row appears.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- The test-studio Inbox pane renders with the canary registered.
