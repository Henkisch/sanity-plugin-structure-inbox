# Plan 029: Fix the README's stale "Develop & test" workspace table

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- README.md test-studio/sanity.config.ts`
> If either file changed since this plan was written, re-read both in full
> before proceeding — the fix depends on `test-studio/sanity.config.ts`
> actually describing one workspace named `default`.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

`README.md`'s "Develop & test" section documents three `test-studio`
workspaces (`default`, `noList`, `multi`) at three different URL paths. Only
one workspace exists today — commit `2e98403` ("refactor: remove team view
and every dev-only test-studio spike") collapsed `test-studio/sanity.config.ts`
down to a single `default` workspace, but never touched this table. A new
contributor following this section verbatim will try to visit `/no-list` or
`/multi` and get nothing, with no clue why. The `default` row's own
description is also wrong now — it describes a second plugin overriding
`activeToolLayout`, which was the `activeToolLayoutProbe` workspace, also
deleted in that same commit.

## Current state

- `README.md:908-931` — the whole "Develop & test" section:
  ```md
  ## Develop & test

  The repo ships a test Studio as an npm workspace.

  \`\`\`sh
  npm install
  cp test-studio/.env.example test-studio/.env   # then fill in a project id
  npm run build                                  # required — see below
  npm run dev                                    # http://localhost:3333
  \`\`\`

  The test Studio consumes the plugin's `dist/`, not `src/`, so **a source change is invisible until
  you rebuild**. For a tighter loop, run `npm run link-watch` in one terminal and `npm run dev` in
  another.

  It ships three workspaces, one per behaviour worth checking by hand:

  | Workspace | Path       | What it covers                                                                                        |
  | --------- | ---------- | ----------------------------------------------------------------------------------------------------- |
  | `default` | `/default` | The happy path, plus a second plugin overriding `activeToolLayout` to prove the chain still composes. |
  | `noList`  | `/no-list` | A structure whose root is a document list rather than a list — the Inbox still resolves.              |
  | `multi`   | `/multi`   | Two structure tools with the Inbox attached to only one of them.                                      |

  Other scripts: `npm test`, `npm run lint`, `npm run format`, `npm run typecheck`.
  ```
- `test-studio/sanity.config.ts:40-95` — the entire current file: one
  `export default defineConfig({name: 'default', title: 'Structure Inbox',
  basePath: '/default', ...})` object. No `noList`/`multi` workspace exists
  anywhere in this file, and no `activeToolLayoutProbe` plugin is imported
  or referenced (confirmed: `grep -n "activeToolLayoutProbe\|noList\|multi"
  test-studio/sanity.config.ts` returns nothing).
- Everything above and below this section in the README (the npm
  install/build/dev steps, the `dist`-not-`src` warning, the "Other scripts"
  line) is still accurate — only the three-row table and the "It ships
  three workspaces" sentence need to change.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| None — this is a docs-only change with no automated check | — | — |

Manually confirm by reading `test-studio/sanity.config.ts` after your edit
and cross-checking every path/name mentioned in your new README text
against it.

## Scope

**In scope**:
- `README.md` (only the section quoted in "Current state")

**Out of scope**:
- Any other README section.
- `test-studio/sanity.config.ts` itself — this plan only corrects the docs
  to match the code, not the reverse.

## Git workflow

- Commits land directly on `main` in this repo's own history (no PR-only
  convention observed). Match `git log --oneline -10`'s style:
  `type: short imperative summary`, e.g. `docs: fix stale test-studio
  workspace table`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Replace the three-row table and its intro sentence

Replace the "It ships three workspaces..." sentence and the table with a
single sentence describing the one real workspace, e.g.:

```md
It ships one workspace (`default`, at `/default`) with every built-in
source configured, so every behaviour is exercised in one place.
```

Do not invent new claims about what the workspace "proves" or "covers"
beyond what's true today — read `test-studio/sanity.config.ts`'s own
`structureInbox({...})` call (lines 55-91) if you want to name what sources
it configures, but keep this section short; the "Sources" section earlier
in the README already documents each source in full.

**Verify**: `grep -n "noList\|/no-list\|/multi\b" README.md` → no matches.

## Test plan

No automated tests apply to a README change. Manual verification only:
read the edited section aloud against `test-studio/sanity.config.ts`'s
actual content and confirm every path/name/claim is true.

## Done criteria

- [ ] `grep -n "noList\|/no-list\|/multi\b" README.md` returns nothing
- [ ] The `default` row/sentence no longer mentions `activeToolLayout` or a
      second plugin
- [ ] No files outside `README.md` are modified (`git status`)
- [ ] `plans/README.md` status row for 029 updated

## STOP conditions

- `test-studio/sanity.config.ts` has more than one workspace when you check
  it (contradicts this plan's premise — re-read the file and adjust the
  table to match reality instead of deleting rows blindly).

## Maintenance notes

If `test-studio` ever grows a second workspace again, update this same
section rather than letting it drift stale a second time — this exact
failure (docs describing deleted dev-workspaces) is what this plan fixes.
