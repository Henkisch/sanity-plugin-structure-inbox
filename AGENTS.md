# AGENTS.md

This repo is `sanity-plugin-structure-inbox`, a Sanity Studio v6 plugin that
fills the Structure tool's empty canvas with an inbox. `README.md` is the full
user-facing reference (usage, sources, options, recipes) — read it for
anything not covered below. This file is only the invariants that live
elsewhere in prose comments and could otherwise be missed by an agent that
starts from the repo root.

## Commands

- `npm run typecheck` — `tsc --noEmit -p tsconfig.json`
- `npm run lint` — `oxlint src`
- `npm test` — `vitest run` (`npm run test:watch` for watch mode)
- `npm run build` — `plugin-kit verify-package --silent && pkg-utils build --strict --check --clean`
- `npm run dev` — runs the `test-studio` workspace's dev server

The test Studio (`test-studio/`) consumes the plugin's built `dist/`, not
`src/` — **a source change is invisible until you rebuild** (`npm run
build`). For a tighter loop, run `npm run link-watch` in one terminal and
`npm run dev` in another. See README's "Develop & test" section for the full
setup (env file, workspace layout).

## Commit messages are load-bearing

`release.config.cjs` (not `.releaserc.json`) extends
`@sanity/semantic-release-preset` and additionally patches
`commit-analyzer`'s `releaseRules` so a `docs(readme):` commit cuts a patch
release. Configure releases **only** in that file: semantic-release would
load a `.releaserc.json` instead of it, silently dropping both that rule and
`branches: ['main']`.

Commit messages must follow Conventional Commits (`type: summary`, e.g.
`fix:` / `feat:` / `docs:`). This isn't a style nit — `semantic-release`
reads the commit history to decide whether to cut a release at all and what
version bump it gets. An unconventional message can mean no release, or the
wrong one.

## Plugin ordering: `structureInbox()` after `structureTool()`

`structureInbox()` must be listed **after** `structureTool()` in a consuming
Studio's `plugins` array. The plugin works by finding the structure tool
already in that array and wrapping its existing resolver (see
`src/plugin.tsx`'s `tools` callback) — a tool that hasn't been added yet
can't be found. This already fails gracefully, not silently: if the target
tool isn't found, `warnOnce` (`src/plugin.tsx`) logs a console warning
naming the problem and the Inbox pane is simply not added, rather than
throwing.

## The per-editor store types must stay unregistered

`structureInbox.dismissals`, `.snoozes`, `.todos`, `.assessments`, and
`.assignment` are real document types written through the client, but they
must **never** be added to a Studio's own `schema.types`. Per
`src/store/useDismissals.ts`'s own reasoning: these are preferences, not
content — an editor should never meet one in the structure tool, in search,
or in a reference picker. Writing an unregistered type through the client is
fully supported; only the Studio's own UI cares about schema registration.

That's the only thing these five share, though: `.assignment` is *not* a
per-editor document like the other four (its own `_id` suffix is a hash of
a target id, not a user id — see `EDITOR_DOC_TYPES`'s own doc comment in
`src/staleEditorDocs.ts` before treating it as a fifth member of that list).

## This repo plans its own work in `plans/`

In-flight and historical work is tracked as executable plans under
`plans/`, indexed in `plans/README.md` (status, priority, dependencies).
Check there before assuming a finding, idea, or gap is new — it may already
be planned, in progress, done, or deliberately rejected with reasoning
recorded.

## A source's `useItems` result must not churn identity per render

`SourceFeed` reports a source's result up to `Inbox`, which stores it as state,
so anything in that result whose identity changes on every render becomes a
render on every render — React's "Maximum update depth exceeded", and the whole
Structure tool with it. This has now bitten three times: `assign` (fixed with
the fingerprint dependency list in `src/inbox/SourceFeed.tsx`), `items` (fixed
by `src/inbox/useStableItems.ts`, after it took down a real customer Studio),
and a per-render `new Error(...)` in `needsAttention`/`upcomingReleases`'
releases-unavailable branch (fixed by hoisting it to a module constant).

So: anything a `useItems` returns on a path it takes *every* render — a
fallback result, an error, an empty list — belongs at module scope or behind a
`useMemo`, never built inline. Integrators' own sources are covered by
`useStableItems`; the built-ins should not be relying on it.

## A new `InboxSourceResult` field must be wired in three places

`SourceFeed.tsx` is the one funnel every source's result passes through
before `onReport`. A new capability has to be added to the destructure, to
the `capabilities` ref (twice — initial value and refresh effect), and to its
own `has*`/fingerprint entry in the report effect's dependency list. Miss any
and the capability ships as a dead click: this happened four times
(`proposeFix`, `assigneeReadOnly`, `openDetail`, `reopen`) before the
`CapabilityKey` mapped type made the first two a `npm run typecheck` failure.
The fingerprint entry is still by hand — if a capability appears but never
updates, that is where to look.

## The `sanity` peer floor is `^6.10.0`, and it is load-bearing

`@sanity/plugin-kit` requires `@sanity/ui` to be a **dependency**, not a peer
(`verify-package` fails the build otherwise), so this plugin ships its own copy.
That is only safe while the studio's copy satisfies the same major.

`sanity@6.10.0` is the first release that moved from `@sanity/ui` v3 to v4 —
a change *inside* the 6.x line, not at a major boundary. On any studio below it,
npm resolves two copies of `@sanity/ui`, and this plugin's v4 components render
against the studio's v3 styles. The visible result is not an obvious error: a
`Checkbox`'s visually-hidden input loses its positioned wrapper and stretches
over the whole pane, swallowing every click. It cost a customer half a day, and
the peer range said `^6.0.0-0` the whole time, so their install looked clean.

Do not widen this range to court older studios. A refused install is the
feature. The same reasoning applies to `@sanity/icons` (v5 moved icons to
subpath exports, `@sanity/icons/Trash` rather than the package root).

A package this plugin lists in `dependencies` that `sanity` also depends on
must have a range satisfiable by **every** `sanity` version the peer range
allows — `sanity` pins its Sanity-scoped dependencies to exact versions, so a
floor above the peer floor forces a second nested copy. Check the registry
rather than assuming symmetry: `@sanity/validation` does not exist below
6.12 (it was split out of `sanity` then), which is why its range is
`^6.12.0` while `@sanity/types` is `^6.10.0`.

A duplicate copy is not automatically a bug, either. The `@sanity/ui`
incident above was severe because v3 and v4 genuinely behaved differently.
The three guards this plugin imports from `@sanity/types`
(`isDocumentSchemaType`, `isImageSchemaType`, `isObjectSchemaType`) are pure
duck-typing over plain objects and byte-identical across 6.10–6.13, so a
second copy of *those* costs bundle size and nothing else. Check which kind
you have before treating a duplicate as an emergency.

## Maintenance

If a genuinely new invariant of this shape emerges (something that silently
breaks the build, release, or Studio if violated — not just a style
preference), add it here rather than leaving it only in a scattered code
comment.
