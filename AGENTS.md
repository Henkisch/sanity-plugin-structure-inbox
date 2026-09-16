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

`.releaserc.json` extends `@sanity/semantic-release-preset`, so commit
messages must follow Conventional Commits (`type: summary`, e.g. `fix:` /
`feat:` / `docs:`). This isn't a style nit — `semantic-release` reads the
commit history to decide whether to cut a release at all and what version
bump it gets. An unconventional message can mean no release, or the wrong
one.

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

## This repo plans its own work in `plans/`

In-flight and historical work is tracked as executable plans under
`plans/`, indexed in `plans/README.md` (status, priority, dependencies).
Check there before assuming a finding, idea, or gap is new — it may already
be planned, in progress, done, or deliberately rejected with reasoning
recorded.

## Maintenance

If a genuinely new invariant of this shape emerges (something that silently
breaks the build, release, or Studio if violated — not just a style
preference), add it here rather than leaving it only in a scattered code
comment.
