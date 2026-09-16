# Plan 041: Add `AGENTS.md` — the invariants that live only in prose comments today

> **Executor instructions**: Follow this plan step by step. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- package.json .releaserc.json src/plugin.tsx src/store/useDismissals.ts test-studio/sanity.config.ts README.md`
> If any of these changed since this plan was written, re-verify the
> specific claims below against the current file before writing them into
> `AGENTS.md` — this file's whole value is being *accurate*, so do not
> copy a possibly-stale claim forward.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

This repo has no `AGENTS.md`/`CLAUDE.md` at its root. Several invariants
that will silently break the build, the release, or the Studio if
violated live only in scattered prose comments and doc-comments today —
real, verified, load-bearing facts, not speculative advice:

- Conventional commit messages are load-bearing for `semantic-release`
  (confirmed: `.releaserc.json` extends `@sanity/semantic-release-preset`)
  — an unconventional commit message doesn't just look wrong, it can
  produce no release or the wrong version bump.
- `test-studio` consumes the plugin's built `dist/`, not `src/` — a
  source change is invisible until a rebuild (already documented in
  `README.md`'s own "Develop & test" section, but not in a place an
  agent working purely from the repo root, without reading the full
  README, would necessarily see first).
- `structureInbox()` must be listed **after** `structureTool()` in a
  Studio's `plugins` array (confirmed: `src/plugin.tsx:16-17`'s own doc
  comment, and enforced at runtime via a `warnOnce` at `src/plugin.tsx:47-52`
  if the target tool isn't found — already handled gracefully, but a
  contributor debugging "why is my Inbox pane missing" benefits from
  knowing this up front).
- The per-editor store types (`structureInbox.dismissals`,
  `.snoozes`, `.todos`, `.assessments`, `.assignment`) must **never** be
  registered in a Studio's own schema (confirmed reasoning at
  `src/store/useDismissals.ts:15-21`: "an editor should not meet it in
  the structure tool, in search, or in a reference picker... only the
  Studio's own UI cares about registration").
- This repo already runs its own improvement/planning workflow through
  `plans/` (see `plans/README.md`) — an agent arriving fresh should know
  that's where in-flight and historical work is tracked, not just
  `git log`.

This is exactly the kind of thing an `AGENTS.md` exists for — this repo's
own workflow is agent-executed plans (this very plan is one), so the gap
is a little ironic. Independently re-found by two separate `/improve`-style
audit passes now (see `plans/README.md`'s own "Known findings with no plan
yet" section) — worth finally closing.

## Current state

- No `AGENTS.md` or `CLAUDE.md` exists at the repo root (confirmed: `ls
  AGENTS.md CLAUDE.md` → both "No such file or directory").
- `README.md` already documents the build/test/dev workflow in full detail
  (its own "Develop & test" section) — `AGENTS.md` should point to it
  rather than duplicate it at length, and add only what's missing:
  the invariants above, framed for an agent making changes, not for a
  human reading feature docs.
- `package.json`'s `scripts` (confirmed, current):
  ```json
  "build": "plugin-kit verify-package --silent && pkg-utils build --strict --check --clean",
  "dev": "npm run dev --workspace test-studio",
  "format": "oxfmt",
  "link-watch": "plugin-kit link-watch",
  "lint": "oxlint src",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "watch": "pkg-utils watch --strict"
  ```
- `plans/README.md` already exists and documents this repo's own
  `/improve`-style workflow (audit → vet → plan → execute → review) in
  detail — `AGENTS.md` should mention it exists and link to it, not
  restate its contents.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| None — this creates one new file, no automated check applies | — | — |

Manually cross-check every factual claim in the new file against the
actual current source (same discipline as every other doc-only plan this
session has written) before considering it done.

## Scope

**In scope**:
- `AGENTS.md` (new file, repo root)

**Out of scope**:
- `README.md` — unchanged; `AGENTS.md` links to it rather than duplicating
  its content.
- `CLAUDE.md` — not creating a second, competing file; most agentic tools
  (Claude Code included) already read `AGENTS.md` when present, or a repo
  can symlink `CLAUDE.md` to it later if a specific tool needs the other
  name — not this plan's concern.
- `plans/README.md` — unchanged, only referenced.

## Git workflow

- Commits land directly on `main`. Message style: `docs: add AGENTS.md`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Write `AGENTS.md`

Create `AGENTS.md` at the repo root with, at minimum, these sections
(exact wording is the executor's own judgment — the content below is
what must be present and accurate, not a literal template to copy
verbatim):

1. **One-line orientation**: what this repo is (a Sanity Studio v6
   plugin, npm package `sanity-plugin-structure-inbox`), and that
   `README.md` is the full user-facing reference.
2. **Commands**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run
   build`, `npm run dev` (with the same `dist`-not-`src` caveat the
   README's own "Develop & test" section states — link to it rather than
   re-explaining the `link-watch` workflow in full).
3. **Commit messages are load-bearing**: conventional commit format
   (`type: summary`) is required for `semantic-release` (via
   `@sanity/semantic-release-preset`) to compute the right version bump —
   an unconventional message can mean no release or a wrong one, not just
   a style nit.
4. **Plugin ordering**: `structureInbox()` must be listed after
   `structureTool()` in a consuming Studio's `plugins` array — state why
   in one sentence (it wraps the existing structure tool's own resolver)
   and note it already fails gracefully with a console warning, not
   silently, if misordered.
5. **The per-editor store types must stay unregistered**: name them
   (`structureInbox.dismissals`/`.snoozes`/`.todos`/`.assessments`/
   `.assignment`) and state why in one sentence (preferences, not
   content — an editor should never meet one in the structure tool,
   search, or a reference picker).
6. **This repo plans its own work in `plans/`**: one sentence pointing at
   `plans/README.md` for in-flight and historical work, so an agent
   starting fresh checks there before assuming a finding is new.

### Step 2: Cross-check every claim

Before considering this done, re-read each of the 4 files named in this
plan's own "Current state" section and confirm every specific claim
(exact commit-message convention, exact plugin ordering behavior, exact
store type names, exact script names) still matches what `AGENTS.md` now
says. This file's only value is being trustworthy — a stale or wrong claim
in it is worse than the file not existing at all.

## Test plan

No automated tests apply to a new documentation file. Manual verification
only: every claim in the new file traces to a real, current line in this
repo (not to this plan's own possibly-stale quotes, which should
themselves be re-verified per Step 2).

## Done criteria

- [ ] `AGENTS.md` exists at the repo root
- [ ] Every claim in it has been re-verified against current source (not
      copied blindly from this plan's own quotes)
- [ ] It links to `README.md` for the full workflow rather than
      duplicating it, and to `plans/README.md` for this repo's own
      planning process
- [ ] No files outside `AGENTS.md` are created or modified (`git status`)
- [ ] `plans/README.md` status row for 041 updated

## STOP conditions

- Any of the specific claims in this plan's own "Current state" section
  no longer matches the real file when re-checked (e.g. `.releaserc.json`
  changed, or `src/plugin.tsx`'s own ordering mechanism changed) — write
  `AGENTS.md` to match current reality, not this plan's quotes, and note
  the discrepancy in your final report.

## Maintenance notes

If a genuinely new invariant of this shape emerges later (something that
silently breaks the build/release/Studio if violated, not just a style
preference), add it here rather than only in a scattered code comment —
that's the whole point of this file existing.
