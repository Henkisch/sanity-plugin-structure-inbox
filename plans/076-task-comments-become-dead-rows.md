# Plan 076: Stop listing comments on Sanity tasks as content-comment rows that go nowhere

> **AMENDED 2026-09-22.** Follow this header where it contradicts the steps
> below it.
>
> **No live Studio check is needed. Withdraw that STOP condition.** The plan
> said the mechanism "needs live confirmation in a Studio with both Tasks and
> field comments, and must not be guessed from bundled source alone". It has
> now been read, not guessed — and from *both branches of the single function*
> that writes these documents in the installed `sanity@6.13.0`, which is
> stronger evidence than one live document:
>
> - `node_modules/sanity/lib/WorkspaceLoader-C5fpcxpj.js:494-570` is the
>   comment `createOperation`. `type === "task"` (`:496-520`) writes
>   `target: {document, documentVersionId, documentType}` — **no `target.path`**,
>   no `context.intent`, no `contentSnapshot`. `type === "field"` (`:520-565`)
>   writes `target.path: {field, selection}` and `context.intent`.
> - `documentType` for a task comment is literally `"tasks.task"`
>   (`TasksStudioActiveToolLayout-BQBG050a.js:2128-2133`).
> - Sanity's own reader agrees: `WorkspaceLoader-C5fpcxpj.js:1015-1027` uses
>   `fieldPath: ""` for tasks and `target.path?.field` for fields.
>
> **The rows never clear, which strengthens the case.** Task comments are
> created `status: "open"` (`TasksStudioActiveToolLayout-BQBG050a.js:1475,
> :1490`) and that bundle contains **zero** occurrences of "resolved" — there
> is no resolve affordance in the Tasks activity feed. So these dead rows
> accumulate permanently rather than ageing out.
>
> **Why the row is dead**: the intent built at `unresolvedComments.ts:277-286`
> navigates to `type: 'tasks.task'`, which is registered only in a separate
> `addon-dataset-<name>` source (`TasksStudioActiveToolLayout:2389-2400`),
> never the main workspace — and `target.document._ref` points into the addon
> dataset, so the id does not exist in the content dataset either. The editor
> gets Sanity's "The document was not found".
>
> **The discriminating data is already in the projection.** The query
> (`unresolvedComments.ts:171-176`) projects `target` **whole**, so
> `target.documentType` and `target.path` both arrive client-side today. A
> filter needs no query change at all if placed client-side.
>
> **The original test plan cannot be executed as written.** It asks for four
> tests against a GROQ-only change. `QUERY` is not exported and `useItems` has
> deliberately no render harness — the file says so at `:44-52` and `:57-61`,
> which is exactly why `commentsFetchLimit` and `selectUnresolvedComments`
> were extracted as pure functions. This dictates *where* the filter goes.
>
> **Do this**: the predicate in **both** places — `defined(target.path)` in the
> GROQ (so task comments stop consuming the `commentsFetchLimit` ×5
> over-fetch budget before `onlyMine` filtering), and the same predicate plus
> a `target.document._ref` presence guard inside `selectUnresolvedComments`
> (`:63-72`), where it is testable today. One line each; the duplication is
> the price of having both the budget and the test.
>
> Prefer the **allowlist** (`defined(target.path)`) over a
> `target.documentType != "tasks.task"` denylist: it survives Sanity adding
> another non-content comment target. It fails closed (a real row would
> disappear) rather than open, and no creation path in 6.13.0 writes a field
> comment without `path` — but Sanity's own reader uses `target.path?.field`
> defensively, so keep that trade-off in mind.
>
> **Line numbers in the steps below are off by ~9.** The query is `:171-176`
> (not `:168-174`); the intent is `:277-286` (not `:282-290`); the
> `navigateIntent` call is `InboxRow.tsx:271`.
>
> **Out of scope, but worth knowing**: a Studio setting `beta.comments.v2`
> writes `_type: "sanity.comment"` through `client.collaboration.comments`,
> and this source returns zero rows silently. Default is v1, so this plan's
> premise holds. Do not try to fix v2 here.
>
> **Verification warning**: confirm `node_modules/.bin/tsc --version` prints a
> version first. An empty `node_modules` makes typecheck and lint exit 0
> having done nothing.

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
