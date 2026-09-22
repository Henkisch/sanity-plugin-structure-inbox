# Plan 083: Decide what the package publishes, and fix the file AGENTS.md names wrongly

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/index.ts src/inbox/types.ts src/ui/SectionCard.tsx README.md AGENTS.md release.config.cjs`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW for the additive half. The subtractive half is semver-major and is deliberately **not** done here.
- **Depends on**: plan 067 (its API-report inventory is the input to Step 2). Execute 067 first.
- **Category**: docs
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Three separate problems, all in the "what does this package promise" bucket.

**1. `AGENTS.md` names a release config file that does not exist.** It says
`.releaserc.json`; the real file is `release.config.cjs`. And that file does
more than extend the preset — it patches `commit-analyzer`'s `releaseRules` so
that `docs(readme):` cuts a **patch release**
(`release.config.cjs:18-24`).

This is not cosmetic: `AGENTS.md` exists so an agent starting from the repo
root gets the load-bearing facts right. An agent told to adjust release
behaviour will create `.releaserc.json` — which semantic-release then loads
*instead of* `release.config.cjs`, silently dropping both the `docs(readme):`
rule and the `branches: ['main']` setting. (Evidence that this misleads
readers: the brief for this very audit repeated the wrong filename, having
inherited it from `AGENTS.md`.)

**2. Nine symbols are published with zero documentation.** Each carries semver
weight with nothing telling anyone what it is for. `grep -c` on `README.md`
returns 0 for all of them: `SectionCard`, `useAssignmentStore`,
`assignmentDocId`, `AssignmentStore`, `suggestAltText`, `AltContext`,
`AssetTarget`, `parseDismissals`, `isDismissed`, `parseTodos`,
`parseAssessments`. `src/index.ts:41-46`'s own comment justifies that block by
citing two README recipes — but those recipes
(`README.md:292`, `:308`) cover only `buildDigest`, `parseSnoozes`,
`findStaleEditorDocuments` and `EDITOR_DOC_TYPES`.

**3. Four `@public`-tagged types are not exported at all.** `CreateItemInput`
(`src/inbox/types.ts:166`), `InboxView` (`:12`), `AskState`
(`src/inbox/AskInbox.tsx:13`), `SnoozePreset`
(`src/store/snoozePresets.ts:9`). `CreateItemInput` is the one with a
demonstrated need: `README.md:178-181` tells integrators to "return `create` to
offer an 'Add' dialog", and both `create` and `update` take a
`CreateItemInput` — so an integrator factoring that handler into a named
function has no way to import its parameter type. Similarly `SectionCard` is
exported without `SectionCardProps`, so a consumer can render it but cannot
type a wrapper around it.

## Current state

`AGENTS.md:26`:

```
`.releaserc.json` extends `@sanity/semantic-release-preset`, so commit
```

`ls .releaserc.json` → No such file. `ls release.config.cjs` → exists.

`release.config.cjs:18-24` — the `releaseRules` patch, with a comment
explaining that semantic-release replaces `plugins` wholesale so a hand-copied
list would drift.

`src/index.ts:17-28,39,47-50` — the export blocks in question.

`src/ui/SectionCard.tsx:7-25` — `SectionCardProps`, not exported, no release
tag. Note `SectionCard` calls `useTranslation(STRUCTURE_INBOX_NAMESPACE)`
(`:38`), so it only renders correctly inside a context where this plugin's i18n
bundle is loaded — currently undocumented.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | `[success]` |
| Tests | `npm test` | all pass |

## Scope

**In scope:** `AGENTS.md`, `README.md` (a new API-reference section),
`src/index.ts` (additive exports only), `src/ui/SectionCard.tsx` (export its
props type), TSDoc tags where plan 067's inventory demands them.

**Out of scope:**
- **Removing any export.** Semver-major. This plan tags and documents; Step 4 only *records* the removal candidates for a future 3.0.
- Renaming anything published.
- Plan 071's type-surface narrowing (different change to the same file).

## Git workflow

- Branch: `advisor/083-api-docs`
- Conventional Commits. **Careful**: per `release.config.cjs:18-24`,
  `docs(readme):` cuts a patch release. Use it only if a release is wanted;
  otherwise use `docs:` with a different scope, or `chore:`. State your choice
  in the report.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix `AGENTS.md`'s release-config section

Correct the filename and add the non-obvious behaviour:

> `release.config.cjs` (not `.releaserc.json`) extends
> `@sanity/semantic-release-preset` and additionally patches
> `commit-analyzer`'s `releaseRules` so a `docs(readme):` commit cuts a patch
> release. Configure releases **only** in that file: semantic-release would
> load a `.releaserc.json` instead of it, silently dropping both that rule and
> `branches: ['main']`.

**Verify**: `grep -c "releaserc" AGENTS.md` → 1 (the warning), and
`grep -c "release.config.cjs" AGENTS.md` → at least 1.

### Step 2: Add the four missing exports

Export from `src/index.ts`: `CreateItemInput`, `InboxView`, `AskState`,
`SnoozePreset` — and `SectionCardProps` from `src/ui/SectionCard.tsx`.

All additive, all already `@public` (verify each tag exists; add it to
`SectionCardProps`, which has none).

**Verify**: `npm run build` → `[success]`, and if plan 067 has landed,
`etc/*.api.md` shows the five additions.

### Step 3: Write the API-reference section the barrel's comment assumes

`README.md` has 25 headings and no API reference. Add one, covering the nine
undocumented symbols with one or two lines each: what it is, and why an
integrator would touch it.

For `SectionCard`, document the i18n-context requirement — a consumer
rendering it outside this plugin's namespace gets untranslated strings, and
nothing currently says so.

For `useAssignmentStore`/`assignmentDocId`/`AssignmentStore`, be honest: these
are internal plumbing, exported without a documented use case. Say that, and
point at Step 4's note rather than inventing a recipe.

**Verify**: `grep -c "useAssignmentStore" README.md` → at least 1; same for the
other eight.

### Step 4: Record the removal candidates for 3.0

Add to `plans/README.md`'s "Known findings with no plan yet":

> **Exports to reconsider in 3.0** — `useAssignmentStore`, `assignmentDocId`,
> `AssignmentStore` are internal plumbing published with no documented use
> case (and `useAssignmentStore` is what dragged 10k lines of `@sanity/client`
> types into the published surface — see plan 071). Removing them is
> semver-major; they are now documented as internal rather than removed. Decide
> at the next major.

**Verify**: `grep -c "Exports to reconsider" plans/README.md` → 1.

## Test plan

No unit tests — documentation and additive exports. Verification is the build
plus the greps above.

One real check: `npm run build` must still succeed with the five new exports,
and (if plan 067 landed) the API report diff must contain exactly those five
additions and nothing else.

**Verify**: `npm test` → all pass (unchanged).

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] `grep -c "release.config.cjs" AGENTS.md` → at least 1, and the `docs(readme):` behaviour is documented
- [ ] `ls .releaserc.json` still returns "No such file" (you did not create it)
- [ ] `src/index.ts` exports the four types; `SectionCardProps` is exported and `@public`
- [ ] `README.md` has an API-reference section covering all nine previously-undocumented symbols
- [ ] `SectionCard`'s i18n-context requirement is documented
- [ ] Step 4's note is in `plans/README.md`
- [ ] `git diff src/index.ts` shows **only additions**
- [ ] Your report states which commit type/scope you used and why
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 067's inventory lists symbols not covered here. Report the difference;
  the two lists should reconcile.
- Exporting one of the four types pulls a large type graph into
  `dist/index.d.ts` (measure with `wc -l dist/index.d.ts` before and after —
  plan 071 has the baseline of 11,380). If an addition makes it worse, stop:
  that is the same bug plan 071 is fixing.
- Any of the four is not actually `@public` in the code. Tag it deliberately
  rather than exporting an untagged symbol.

## Maintenance notes

- After plan 067, a new export shows up as an `etc/*.api.md` diff. That plus
  this README section is the contract: **published means documented.**
- A reviewer should check the commit scope. A stray `docs(readme):` publishes a
  patch release, which is a surprising consequence of a documentation commit
  and is exactly the kind of thing `AGENTS.md` now warns about.
