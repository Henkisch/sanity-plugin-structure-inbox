# Plan 076: Stop listing comments on Sanity tasks as content-comment rows that go nowhere

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/unresolvedComments.ts src/inbox/sources/unresolvedComments.test.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — narrows the result set.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21
- **Confidence note**: the mechanism was read from Sanity's own bundled source rather than reproduced live. Step 1 is a live confirmation — do it before changing anything.

## Why this matters

`unresolvedComments` filters on `_type == "comment" && status == "open" && !defined(parentCommentId)`
with **no discriminator on what the comment is attached to**.

Sanity's Tasks feature stores task comments as plain `_type: 'comment'`
documents in the same addon dataset, with `target.documentType: 'tasks.task'`
and — unlike field comments — no `target.path` and no `context.intent`.

So in any Studio using Tasks (the same paid tier that enables Comments, and the
tier this source is built for), every open comment on a task becomes an inbox
row reading "tasks.task · document", whose click fires an `edit` intent for a
`tasks.task` id that exists only in the addon dataset. `tasks.task` is not a
registered type in the content dataset, so the row is a dead end.

With `onlyMine: true` (the default) it fires exactly when someone @-mentions
you on a task — the case the source most wants to get right.

## Current state

`src/inbox/sources/unresolvedComments.ts:168-174` — the query, with no
discriminator.

`:274` — the subtitle: `` subtitle: `${row.target.documentType} · …` ``

`:282-290` — the `edit` intent on `row.target.document._ref`.

Both `:274` and `:285` are unguarded deep reads into data this plugin does not
own.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| This suite | `npx vitest run src/inbox/sources/unresolvedComments.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope:** `src/inbox/sources/unresolvedComments.ts`,
`src/inbox/sources/unresolvedComments.test.ts`

**Out of scope:** `src/inbox/sources/openTasks.ts` (tasks have their own
source; this plan does not route task comments there — see Maintenance notes).

## Git workflow

- Branch: `advisor/076-task-comments`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the comment shape live

In a Studio that has both Tasks and field comments, add a comment to a task and
a comment on a document field, then query the addon dataset for both and record
their actual shapes — specifically `target.documentType`, `target.path` and
`context.intent`.

If no such Studio is available, say so and stop: the discriminator must be
chosen from real data, not from a bundled-source reading.

**Verify**: your report contains both documents' relevant fields.

### Step 2: Add the discriminator to the query

Based on Step 1, exclude task comments. Likely shape (confirm against your
data):

```groq
_type == "comment" && status == "open" && !defined(parentCommentId)
  && target.documentType != "tasks.task"
```

Prefer a **positive** discriminator if Step 1 supports one (e.g.
`defined(target.path)` or `defined(context.intent)`) — an allowlist survives
Sanity adding a second non-content comment type, a denylist does not. Say which
you chose and why.

**Verify**: `npx vitest run src/inbox/sources/unresolvedComments.test.ts` → all pass.

### Step 3: Guard the deep reads

At `:274` and `:285`, skip a row whose `target.document._ref` or
`target.documentType` is missing, rather than dereferencing it during render.

**Verify**: `npm run typecheck` → exit 0.

## Test plan

1. A field comment produces a row with the right subtitle and intent.
2. A task-shaped comment (`target.documentType: 'tasks.task'`, no `target.path`) produces **no** row. *This is the regression.*
3. A comment with a missing `target.document` produces no row and does not throw.
4. `onlyMine: true` with a task comment mentioning the current user → still no row.

**Verify**: `npm test` → all pass, 4 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Step 1's live shapes are recorded
- [ ] The query carries a discriminator, and your report says whether it is an allowlist or denylist and why
- [ ] Test 2 was confirmed to fail before the change
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 cannot be done (no Studio with both features). Do not guess the
  discriminator from bundled source alone — report and pause.
- Step 1 shows field comments **also** lack `target.path` in some cases. Then a
  positive discriminator would drop real rows; report the shapes.
- Excluding task comments turns out to drop rows a user would want. Report
  rather than deciding.

## Maintenance notes

- Deferred deliberately: **surfacing task comments properly**, via `openTasks`
  or a new source, with an intent that opens Sanity's own Tasks panel (the
  `openTaskDetail.ts` helper already exists for that). This plan only stops
  them appearing as broken content-comment rows.
- A reviewer should ask whether the discriminator is an allowlist. If Sanity
  adds another comment type on a non-content target, a denylist silently
  regresses.
