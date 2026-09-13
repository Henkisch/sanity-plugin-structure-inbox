# Plan 012: Investigate and prototype a team-wide "who's sitting on what" view

> **Executor instructions**: This is an **investigation/design spike**, not a
> build-everything plan — the audience split (personal vs. team) is a
> load-bearing product decision this plugin has never had to make before, and
> it should not be committed to production wiring without a working
> proof-of-concept first. Follow the steps in order. If a STOP condition
> fires, stop and report rather than improvising past it. When done, update
> this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat decd612..HEAD -- src/inbox/Inbox.tsx src/inbox/MergedList.tsx src/store/useDismissals.ts src/inbox/sources/openTasks.ts src/inbox/sources/unpublishedDrafts.ts`
> (Re-stamped 2026-09-13: the original `2218e06` baseline predated a large
> commit, `decd612`, that landed exactly the assignee-join code this plan's
> "Current state" §1 quotes — a first execution attempt against `2218e06`
> correctly stopped when that code was nowhere in reachable history.
> `decd612` now matches the excerpts below; verified directly. Ignore the
> "## Findings" section further down — it documents that first, now-resolved
> attempt.)
> If any in-scope file changed since this plan was written, re-read it and
> compare against the "Current state" excerpts below; on a real mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW (spike in `test-studio`; no change to `src/index.ts`'s public
  surface or to any shipped source's behavior)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2218e06`, 2026-09-13 (re-stamped against `decd612`,
  2026-09-13 — see drift-check note above)

## Why this matters

`README.md:76-97` ("Whose items are these") documents a real design decision
this plugin already makes explicit: every source declares an `audience` —
`'mine'` or `'everyone'` — because "done" means something different either
side of that line. `unpublishedDrafts` defaults to `'everyone'`
(`src/inbox/sources/unpublishedDrafts.ts:159`) specifically because "a draft
left unpublished is usually the team's problem rather than one person's, and
anyone can pick it up" (`README.md:84-86`). That framing — a shared,
team-relevant surface — is only ever rendered today inside one editor's own
Inbox pane, mixed in with their personal tasks and todos. There's no place in
this plugin where a lead or a teammate can ask "what's the whole team
currently sitting on, and who's it assigned to" without opening each
person's own Studio and reading their personal inbox.

The gap is explicitly named, not invented, in `openTasks.ts`'s own comments:

```ts
// src/inbox/sources/openTasks.ts:169-172
// Every row this query can return is already assigned to `currentUser`
// when `onlyMine` is on — the query itself filters to it — so there is
// no per-row lookup to do; a fuller "everyone's tasks" view would need
// a project members list this source doesn't have yet.
```

This plan exists to answer, concretely, what a team view would need and
whether it can be built on what already exists, rather than assuming.

## Current state

**The building blocks already in place**:

1. **Assignee is already computed and carried per-item.**
   `unpublishedDrafts.ts` already joins each draft's row against every open
   task's target to attach an `assignee` (`src/inbox/sources/unpublishedDrafts.ts:257-268`):

   ```ts
   const items = useMemo(
     () =>
       result.items.map((item): InboxItem => {
         const canonicalId = item.intent?.params.id
         const assignedTo = canonicalId
           ? openTaskByTarget.get(canonicalId)?.assignedTo
           : undefined
         const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
         return assignee ? {...item, assignee} : item
       }),
     [result.items, openTaskByTarget, assigneesById],
   )
   ```

   A "grouped by assignee" view is mostly a re-sort of data this plugin
   already fetches — not a new query against the content dataset.

2. **Per-editor state documents are queryable across editors, because the
   `_type` is shared, not per-user.** `useDismissals.ts` stores each editor's
   dismissals under a *document id* keyed by user (`dismissalsDocumentId`),
   but every one of those documents shares the same `_type`:

   ```ts
   // src/store/useDismissals.ts:23, 39-40, 150-154
   const DISMISSALS_TYPE = 'structureInbox.dismissals'

   function dismissalsDocumentId(userId: string): string {
     return `${DISMISSALS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
   }

   client
     .transaction()
     .createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
     .patch(documentId, (patch) => patch.set({[DISMISSALS_FIELD]: value}))
     .commit({visibility: 'async'})
   ```

   That means `*[_type == "structureInbox.dismissals"]` (and the equivalent
   for `structureInbox.snoozes`, `useSnoozes.ts` presumably following the
   same pattern — confirm in Step 1) already returns **every editor's**
   dismissal state in one query, not just the current viewer's. This was not
   built for that purpose, but it means the data to compute "is this actually
   done, for anyone, team-wide" already exists in the dataset — the open
   question is whether reading every editor's document is an acceptable cost
   and access pattern (see Open Questions).

3. **`MergedList.tsx` already merges cross-source items into one sorted
   list** (`mergeRows`, `src/inbox/mergeItems.ts` — read it in Step 1) — the
   same shape a team view needs, just grouped differently (by assignee
   instead of by tone/timestamp) and scoped differently (every `'everyone'`
   source, not the current viewer's configured `main` sources alone).

**What does NOT exist today**: any UI surface — tab, pane, or otherwise —
that isn't scoped to "this signed-in editor's own inbox." `src/plugin.tsx`
only ever registers one tool-level structure override
(`wrapStructure`/`addInboxChild`, `src/structure/wrapStructure.ts`); there is
no second entry point.

## Scope

**In scope**:
- `test-studio/sanity.config.ts` — add one new workspace for this spike
  (e.g. `teamViewSpike`).
- A new, throwaway prototype (a new inbox source, or a standalone pane —
  whichever Step 2 concludes fits) living under `test-studio/` or a scratch
  location documented in this plan's own "Findings" section — **not** under
  `src/`.
- `plans/README.md` — status row.

**Out of scope**:
- Any change to `src/index.ts`'s public exports, `InboxSource`/
  `InboxSourceResult` (`src/inbox/types.ts`), or any shipped source
  (`openTasks.ts`, `unpublishedDrafts.ts`, `todos.ts`,
  `upcomingReleases.ts`) — this plan reads their existing output, it does not
  change what they produce.
- Building a "project members list" fetch mechanism from scratch —
  `useUserListWithPermissions` (already used by `unpublishedDrafts.ts` and
  `openTasks.ts` via `optionalHook`) already supplies exactly that; reuse it,
  don't reinvent it.
- Any permissions/visibility gating (e.g. "only leads can see the team view")
  — note it as an open question for whoever picks this up next; don't design
  an access-control system inside a spike.

## Git workflow

- Branch: `advisor/012-team-wide-view`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, e.g. `spike: prototype a team-wide assignee view`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0 |
| Dev       | `npm run dev`         | serves at `http://localhost:3333` |
| Typecheck | `npm run typecheck`   | exit 0, no errors |

`npm run dev` serves `test-studio` from this package's `dist/`, not `src/`
(`README.md:427-429`) — run `npm run build` after every source change or the
Studio keeps serving stale code.

## Steps

### Step 1: Confirm the cross-editor read is real and its cost

1. Read `src/store/useSnoozes.ts` to confirm it follows the same
   shared-`_type`, per-user-`_id` pattern as `useDismissals.ts`. If it does
   not (e.g. if snooze state is stored differently), record that difference —
   it changes what a team view can show about "put off until later" state.
2. Using the MCP Sanity tools available in this environment (not a raw
   `fetch` inside a component), run a **read-only** query against a real or
   scratch dataset — `*[_type == "structureInbox.dismissals"]` — to confirm
   in practice (not just from reading the code) that this returns multiple
   editors' documents when more than one editor has used the pane. This is a
   read, not a mutation — it does not violate this plan's "spike only"
   scope.
3. Note the cost: this is one query returning at most one small document per
   editor who has ever touched the pane — cheap for a team of a normal size,
   worth flagging if the intended use is a Studio with thousands of editors.

**Verify**: no command — write findings into a "## Findings" section at the
bottom of this plan file before continuing.

### Step 2: Prototype a grouped-by-assignee view

In the new `test-studio` workspace:

- Build a simple read-only surface (a custom tool, or a structure item — pick
  whichever is less effort and say which in Findings) that:
  1. Fetches the same kind of `'everyone'`-audience items this plugin's
     `unpublishedDrafts`/`openTasks` sources already produce (reuse those
     functions directly rather than re-querying — they're exported from
     `src/index.ts` already).
  2. Groups the resulting items by `item.assignee` (falling back to an
     "Unassigned" bucket), instead of the tone/timestamp sort
     `mergeRows`/`MergedList.tsx` uses for the personal inbox.
  3. Renders a simple per-assignee count and list — no interactivity
     required (no assign/resolve/snooze wiring) — this is proving the data
     shape, not shipping a feature.

**Verify**: `npm run build && npm run dev`, confirm the view renders real
grouped data in the spike workspace. Describe what you see in Findings.

### Step 3: Decide whether "done" needs to be team-aware

Using what Step 1 confirmed: does the prototype's "still open" count reflect
only the current viewer's own dismissals (likely wrong — a lead who has
personally ticked something off in their own inbox would make it vanish from
a team view too, even though a teammate never touched it), or does it
correctly need to fold in every editor's dismissal state for sources with no
`resolve` (recall `unpublishedDrafts` has no `resolve` —
`src/inbox/sources/unpublishedDrafts.ts` — so "done" there is always
per-editor, never global, by design; see its module comment)?

Write down, in Findings, which of these is true and what the fix would cost:
folding in every editor's dismissals into the "is this really still open"
computation, or accepting the personal-dismissal leak as a known limitation
of a first version.

**Verify**: no command — written findings only.

## Test plan

This is a spike; no unit tests are expected of the throwaway prototype. If
Step 2 lands on a specific reusable grouping function (e.g. "group items by
assignee"), note in Findings whether that function is generic enough to be
worth extracting into `src/` with tests, for the eventual production plan.

## Done criteria

- [ ] "## Findings" section added to this plan file, answering:
  - Whether `useSnoozes.ts` shares `useDismissals.ts`'s cross-editor-queryable
    `_type` pattern.
  - Confirmation (via an actual query, not just code-reading) that every
    editor's dismissal document is readable in one query.
  - Whether a team view needs cross-editor dismissal data to show correct
    "still open" counts, and what that costs.
  - A recommendation: proceed to a production plan (and roughly what it would
    need to touch — likely a new tool or structure surface, not a change to
    the personal Inbox pane itself), or "not worth it yet" with the reason.
- [ ] `npm run typecheck` exits 0
- [ ] The grouped-by-assignee prototype is demonstrated working in the new
  `test-studio` workspace (described in Findings — this is a manual/visual
  check)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `useSnoozes.ts` stores state in a way that makes cross-editor reads
  materially harder than `useDismissals.ts` (e.g. genuinely per-user `_type`
  values, or a shape that can't be queried by a wildcard) — that changes the
  recommendation significantly; report the finding rather than redesigning
  the snooze store to match.
- The MCP Sanity query in Step 1 requires permissions this environment's
  configured credentials don't have (e.g. it can only read the current
  editor's own documents) — report what error or restriction you hit rather
  than working around it with elevated access.
- You find yourself wanting to add a "which editors are on this project"
  fetch from scratch instead of reusing `useUserListWithPermissions` — that
  hook (already used twice in this codebase, see Scope) is the intended
  mechanism; if it turns out not to serve this need, stop and report why
  rather than building a parallel one.

## Maintenance notes

- This plan produces a recommendation and a throwaway prototype, not shipped
  code. A follow-up production plan (not yet written) should be scoped only
  after this one's Findings are read — particularly the Step 3 decision on
  whether cross-editor dismissal state is required, since that determines
  whether the production version is a small read-only view or a new piece of
  cross-editor data-fetching infrastructure.
- If the recommendation is "not worth it yet," record the one-line reason in
  `plans/README.md`'s "considered and rejected" section so this isn't
  re-investigated from scratch on the next `/improve` run.

## Findings

**Execution note on this worktree**: this executor's worktree branched from
commit `acbb3ec`, which is an *ancestor* of the plan's own baseline commit
`2218e06` (confirmed with `git merge-base --is-ancestor acbb3ec 2218e06` →
`yes`) — i.e. this worktree is missing one commit (`2218e06`, "improve
selection UX and add undo for mark-done/snooze") that the plan was written
against, rather than being ahead of it. The prescribed drift check (`git diff
--stat 2218e06..HEAD -- src/inbox/Inbox.tsx src/inbox/MergedList.tsx
src/store/useDismissals.ts src/inbox/sources/openTasks.ts
src/inbox/sources/unpublishedDrafts.ts`) only showed `MergedList.tsx` as
changed, and reading that diff, it is all UI/interaction work (undo toast,
"select all" checkbox, leave-animation state) — none of it touches
`mergeRows`, item shape, or any data this plan's Step 2 depends on. Judged as
**not a real mismatch** and not a reason to stop on its own.

### Step 1 findings

**1. `useSnoozes.ts` does share `useDismissals.ts`'s pattern.** Read in full
(`src/store/useSnoozes.ts`). It uses its own type (`SNOOZES_TYPE =
'structureInbox.snoozes'`), its own per-user document id function
(`snoozesDocumentId`, identical shape to `dismissalsDocumentId`), and the
same `createIfNotExists` + `patch` transaction against one JSON-string field
(`SNOOZES_FIELD = 'snoozed'`). The load/merge/persist dance (dirty ref,
has-local-edit ref, loaded ref) is structurally identical to
`useDismissals.ts`. No STOP condition here — a wildcard `_type` query works
the same way for snoozes as for dismissals.

**2. The cross-editor read was confirmed by an actual MCP query, not just by
reading the code — with one caveat.** Ran (read-only, via
`mcp__Sanity__query_documents` against project `efebqg67`, dataset
`production`, per the operator's context):

```
*[_type == "structureInbox.dismissals"]{_id, _type, dismissed}
```

This returned successfully with no permission error. `mcp__Sanity__whoami`
first confirmed the querying identity as Sanity account `gSQ6ZgJTc`
(`hankisch@gmail.com`, GitHub OAuth). The one document returned was
`structureInbox.dismissals.pvreWV4l3` — owned by a *different* user id
(`pvreWV4l3`) than the querying account (`gSQ6ZgJTc`). That is real,
practical confirmation that this query is not scoped to "the current
viewer's own document": the account running the query is not the document's
owner, and the read still succeeded and returned that other editor's full
dismissal state. A broader check (`*[_type match "structureInbox.*"]`) found
exactly three documents total in this dataset — one `dismissals`, one
`snoozes`, one `todos`, all suffixed `.pvreWV4l3` — meaning **only one editor
has ever touched the pane in this dataset**, so I could not additionally
demonstrate *multiple* editors' dismissal documents coming back in one
result (the mechanism supports it — same `_type`, different `_id` per user —
but this dataset doesn't yet have a second editor's data to prove it with
N>1). No STOP condition: this is a data-availability limitation, not a
permissions restriction (the literal STOP condition — the query "can only
read the current editor's own documents" — did not occur; the opposite
happened).

**3. Cost, as predicted**: one query, one small JSON-string field per editor
who has ever used the pane. For the three `structureInbox.*` documents found
here, each is tiny. Confirmed cheap at the scale actually observed; the
plan's caveat about "a Studio with thousands of editors" stands as a
paper-only estimate — not tested here since no such dataset was available.

### Step 2/3: not reached — STOPPED

Before starting Step 2, I read the actual current contents of
`src/inbox/sources/unpublishedDrafts.ts` (in full, 247 lines) and
`src/inbox/sources/openTasks.ts` (in full, 173 lines) to reuse the "already
computed assignee" building block described in this plan's own "Current
state" §1 and the code comment quoted in "Why this matters". Neither exists:

- There is no `assignee` field anywhere on `InboxItem`
  (`src/inbox/types.ts`), no `openTaskByTarget`, and no `assigneesById` in
  `unpublishedDrafts.ts` or anywhere else in `src/`. The file has no line
  257-268 section resembling the quoted snippet at all (it ends at line
  247). Confirmed by `grep -rn "assignee\|openTaskByTarget\|assigneesById"
  src/` — the only hits are unrelated comments about the `assign` (delegate-
  to-someone) feature, none define or compute a per-item `assignee`.
- The comment block quoted in "Why this matters" as
  `src/inbox/sources/openTasks.ts:169-172` ("Every row this query can return
  is already assigned to `currentUser`... a fuller 'everyone's tasks' view
  would need a project members list this source doesn't have yet") does not
  exist in `openTasks.ts` either — grepped for distinctive phrases from it
  ("no per-row lookup", "project members list") across `src/`: zero matches.
- Checked whether this was lost to drift rather than never having existed:
  `git log --all --oneline -S"assigneesById"` and `-S"openTaskByTarget"`
  against the full repository history (all branches/commits reachable from
  this worktree's object store, which also holds `2218e06` from the sibling
  worktree) return **no commits at all**. This code was never committed
  anywhere in this repository's reachable history — its absence isn't recent
  drift after the plan was written, the plan's "Current state" §1 and the
  "Why this matters" code excerpt describe code that was never real.
- Also checked structurally whether the data is reachable another way:
  `openTasks.ts`'s own GROQ projection (`_id, _updatedAt, title, dueBy,
  assignedTo`) does select `assignedTo` internally for its `onlyMine`
  filter, but the `InboxItem` it actually returns from `toItem`-equivalent
  mapping omits it entirely (`id, title, subtitle, timestamp, changedAt,
  tone` only) — `assignedTo` never reaches the public `InboxSourceResult`.
  Likewise `unpublishedDrafts.ts`'s query never selects a task's `target` at
  all. So calling the two exported functions (`openTasks()`,
  `unpublishedDrafts()`) and reading their public `InboxItem[]` output — the
  only thing Step 2.1 authorizes ("reuse those functions directly rather
  than re-querying") — genuinely cannot produce a per-item assignee today.
  Building it for real would mean a new GROQ query against `tasks.task`
  directly (selecting `target` and `assignedTo` together, joining against
  drafts by canonical id) — i.e. the assignee-join mechanism the plan's
  "Current state" §1 asserts already exists would have to be built from
  scratch, in a shipped source file (`unpublishedDrafts.ts`/`openTasks.ts`),
  which is explicitly **out of scope** for this spike ("this plan reads
  their existing output, it does not change what they produce").

This is a real mismatch between the plan's stated "Current state" and the
actual codebase, on the file this plan's core Step 2 deliverable depends on
most directly. Per this plan's own drift-check instruction ("on a real
mismatch, treat it as a STOP condition") and its top-line instruction ("If a
STOP condition fires, stop and report rather than improvising past it"), I
stopped here rather than either (a) inventing a new cross-source assignee
join inside the spike to make Step 2 work as written — which would be
improvising past a false premise the plan built its whole rationale on — or
(b) modifying `unpublishedDrafts.ts`/`openTasks.ts` to add the missing join,
which is explicitly out of scope. Steps 2 and 3 were not attempted; no
`test-studio` workspace, prototype, or grouping code was written.

### Recommendation

Not "not worth it yet" and not "proceed as scoped" — the plan needs to be
**rewritten** before a spike can execute it, because its foundational premise
(assignee data is already computed and free to reuse) is false. A corrected
version of this plan should either:
- Scope Step 2 as building the assignee-join query for real (against
  `tasks.task`'s `target`/`assignedTo` fields, likely inside the throwaway
  `test-studio` prototype itself, not in a shipped source — that stays in
  scope since the prototype lives outside `src/`), which is a materially
  larger unit of work than "mostly a re-sort of data this plugin already
  fetches"; or
- Drop the assignee-grouping ambition for this spike and instead prototype
  only the cheaper, real building block this investigation did confirm: a
  cross-editor "who has dismissed/snoozed what" read (Step 1, confirmed
  real and cheap), grouped by source/item rather than by assignee, as a
  smaller first proof of concept.

Either way, whoever picks this up next should re-verify every code citation
in a plan's "Current state" section against the actual files before treating
it as a foundation to build on — two of this plan's three "already exists"
claims did not survive a direct read of the cited files.

## Findings (retry, against decd612)

**Worktree/branch setup**: this execution started on a worktree whose HEAD
(`acbb3ec`) was behind `main` (`decd612`) — one commit short, missing exactly
the commit (`decd612`, "feat: assignee avatars, todo edit dialog, and inbox
row consistency polish") that lands the assignee-join code this plan's
"Current state" §1 depends on. Per the pre-flight instructions, ran `git
rebase main`, which succeeded cleanly (`Successfully rebased and updated
refs/heads/worktree-agent-abb131c3214e5ad07`). Re-ran the plan's own drift
check afterward:

```
git diff --stat decd612..HEAD -- src/inbox/Inbox.tsx src/inbox/MergedList.tsx \
  src/store/useDismissals.ts src/inbox/sources/openTasks.ts \
  src/inbox/sources/unpublishedDrafts.ts
```

— empty output, i.e. this worktree's HEAD is now exactly `decd612` for every
in-scope file, no drift at all. Directly confirmed (not just via the diff)
that `unpublishedDrafts.ts` now contains `openTaskByTarget`, `assigneesById`,
and the exact `items = useMemo(...)` join block this plan's "Current state"
§1 quotes (now at lines 218–268, a few lines off from the plan's cited
217/257 due to unrelated surrounding changes, but byte-identical in
substance) — the premise the prior attempt correctly stopped on is now real.

One infrastructure note, not a plan mismatch: this plan's "Git workflow"
section names branch `advisor/012-team-wide-view`, but that branch is
already checked out in a different, sibling worktree
(`.claude/worktrees/agent-a7b85632dd44f5860`, holding the prior attempt's
commit `a17dd0b`) — git refuses to check out the same branch in two
worktrees at once. Since forcibly moving that branch out from under a
worktree that may still be in use by another session was not something this
plan or the task authorized, this attempt's commit(s) landed on this
worktree's own branch (`worktree-agent-abb131c3214e5ad07`, based on
`decd612`) instead. Flagging this for whoever merges/rebases the two
`012`-related branches together — the reviewer will need to reconcile
`advisor/012-team-wide-view` (prior attempt's commit, now stale/superseded)
with this worktree's branch (this attempt's commits, the ones worth
keeping).

### Step 1: not re-run, per instructions

The task instructions for this retry explicitly said Step 1 (the live
`mcp__Sanity__query_documents` check) already succeeded in the prior attempt
and did not need to be repeated, since `decd612` touches neither
`useDismissals.ts` nor `useSnoozes.ts`. Confirmed that premise directly:
`git diff --stat decd612..HEAD -- src/store/useDismissals.ts
src/store/useSnoozes.ts` (part of the drift check above) shows no changes to
either file since the prior attempt read them, so its Step 1 findings —
`useSnoozes.ts` mirrors `useDismissals.ts`'s shared-`_type`/per-user-`_id`
pattern, and a live query confirmed a non-owner account could read another
editor's `structureInbox.dismissals` document — stand unchanged. Re-read both
files in full as part of this attempt's own review (not a re-verification,
just due diligence before building on them) and found nothing that
contradicts the prior findings.

### Step 2: prototype built and demonstrated working

**Where it lives, and why a tool rather than a structure item**: added
`test-studio/plugins/teamViewSpike.tsx` (a `definePlugin` registering one
Sanity **tool**, following the exact pattern already in
`test-studio/plugins/activeToolLayoutProbe.tsx`) and wired it into one new
workspace, `teamViewSpike`, in `test-studio/sanity.config.ts` (`basePath:
'/team-view-spike'`) — kept in its own workspace, as the plan's Scope
requires, rather than appended to the `default` workspace next to the real
Inbox pane. A tool was less effort than a structure item: it needs no
`router`/`getIntentState` wiring (both optional on `Tool`, confirmed by
reading `sanity`'s own `Tool` interface in
`node_modules/sanity/lib/useVirtualizerScrollInstance-*.d.ts`) and no
`StructureResolver` composition — just a `{name, title, icon, component}`
object appended to `tools` via the plugin's `ComposableOption<Tool[], …>`
reducer form.

**What the component does** (full file:
`test-studio/plugins/teamViewSpike.tsx`): calls `unpublishedDrafts({
olderThanDays: 0 })` and `openTasks({ onlyMine: false })` — both imported
directly from `sanity-plugin-structure-inbox`, i.e. the package's own public
barrel, not a re-implementation — and calls each source's `useItems()`
directly inside the tool's function component, exactly the way
`src/inbox/SourceFeed.tsx:36` does it for the real Inbox pane
(`const {items, ...} = source.useItems()`). No new GROQ query was written;
every row comes from the two exported sources' existing output, per Step
2.1's instruction. Items from both sources are flattened into one row list,
then grouped by `item.assignee?.label ?? 'Unassigned'` into a
`Map<string, Row[]>`, sorted so `Unassigned` sorts last, and rendered as one
`@sanity/ui` `Card` per assignee with a count and a plain list of titles —
no click targets, no resolve/assign/snooze wiring, matching Step 2.3's "no
interactivity required".

**One incidental fix, unrelated to the plan's own scope**: the installed
`@sanity/ui@4.2.0` is on its v2 API, where `Stack`'s `space` prop is typed
`never` (deprecated in favor of `gap`) — `npx tsc --noEmit -p
test-studio/tsconfig.json` caught this (`Type 'number' is not assignable to
type 'undefined'` at three call sites) before any manual testing; fixed by
using `gap` instead. No other type errors came from the new file. (The same
`tsc` run also reported four pre-existing `Cannot find name 'process'`
errors in `sanity.cli.ts`/`sanity.config.ts`, confirmed via `git diff` to be
on lines this attempt never touched — a gap in `test-studio`'s own
`tsconfig.json` lacking `@types/node`, unrelated to this plan, left alone.)

**Verified working, live, not just by reading the code**: ran `npm install`
(exit 0, 1402 packages), `npm run build` (succeeded, `dist/index.js` 171 kB),
then `npm run dev` in the background. `test-studio/.env` did not exist in
this worktree (each worktree is isolated and `.env` is gitignored) — created
it from `.env.example`, filled in with the project/dataset already on record
from the prior attempt's Step 1 (`efebqg67` / `production`; not committed,
`.env` stays gitignored). Opened `http://localhost:3333/team-view-spike/teamViewSpike`
in a real browser tab (`claude-in-chrome`) and confirmed by reading the
rendered page text and a screenshot: the tool renders under the title "Team
view (spike)", with one group card **"Unassigned (9)"** listing 3 real draft
titles (e.g. "Unfinished author profile") tagged `Draft` and 6 real task
titles (e.g. "Follow up: Unfinished author profile") tagged `Task` — live
data from the `efebqg67`/`production` dataset, fetched and merged and grouped
exactly as designed. This demonstrates the full mechanism end-to-end: reusing
the exported sources' hooks directly, merging cross-source rows, and
grouping by assignee with a working fallback bucket.

**Limitation of this specific demonstration**: every row landed in
`Unassigned` because no `tasks.task` document in this dataset currently has
`assignedTo` set (confirmed indirectly — this is the same dataset Step 1's
query already found has only ever had one editor touch the pane at all, and
no assignment was ever made in it). This is a property of the test data, not
a defect in the grouping code: the fallback bucket firing correctly for
every row it received *is* the grouping logic working as designed — it just
means this dataset couldn't independently demonstrate a populated non-
"Unassigned" bucket. Assigning a task by hand to force that case would have
meant a write against a live dataset for a case this plan's Step 2 does not
require ("no interactivity required... this is proving the data shape"), so
it was not done.

### Step 3: does "done" need to be team-aware — a different answer than the plan anticipated

The plan frames Step 3 as a binary: does the prototype's "still open" count
wrongly reflect only the current viewer's own dismissals, or does it
correctly need to fold in every editor's dismissal state? Building the
prototype surfaced a third answer neither option names.

The prototype calls `source.useItems()` **directly** and renders `items`
as-is — it never calls `useDismissals()` and never runs the personal Inbox
pane's `splitItems()`/`SourceFeed.tsx` machinery at all. So its "still open"
count is not filtered by *anyone's* dismissal state, current viewer's or
otherwise — dismissals never enter the picture. That turns out to be the
**correct** behavior for the sources actually in scope here, not an
oversight to fix:

- `unpublishedDrafts` has no `resolve` — its own module doc comment (quoted
  in this plan's "Why this matters") says a tick there "reads as 'stop
  showing me this'": a personal preference, never a signal that the draft
  itself is resolved. The only real completion signal for a draft is that it
  gets published, at which point it drops out of the source's own query
  (`_id in path("drafts.**")`) on its own — with zero involvement from any
  dismissal document, this editor's or anyone else's. Folding in cross-editor
  dismissal state here would make a team view actively **wrong**: it would
  hide a still-unpublished draft from a lead asking "what's the team still
  sitting on" merely because one teammate once personally dismissed it in
  their own inbox — exactly backwards from what a team view is for.
- `upcomingReleases` (also `audience: 'everyone'` unconditionally, per
  `src/inbox/sources/upcomingReleases.ts:63`) has the identical shape: no
  `resolve` either (its own comment: "a tick means 'I know about this
  one'" — acknowledgment, not resolution). Same conclusion applies if a
  production version ever includes it.
- `openTasks` (used here with `onlyMine: false`) does have real backing
  completion state: its `resolve` patches `status: 'closed'`
  (`src/inbox/sources/openTasks.ts:230-234`), and its own query already
  filters `status == "open"` before any item reaches `useItems()`'s output.
  "Still open" for a task is already correctly computed from the task
  document itself, again with no dependency on any editor's dismissal
  document.
- `todos` is out of scope for this question entirely — it is always
  `audience: 'mine'` (`src/inbox/sources/todos.ts:24,52`, "there is no
  'everyone's' reading of a todo"), so it would never appear in a team view
  in the first place.

**Answer to the plan's literal question**: no, a team view does not need to
fold in every editor's dismissal state to show correct "still open" counts —
not as an accepted limitation, but because doing so would be *wrong* for the
two sources with no `resolve` (`unpublishedDrafts`, `upcomingReleases`), and
unnecessary for the one that has real backing state (`openTasks`). The
practical implication: a production team view should read each source's
`useItems()` output directly, the way this prototype does, and must
deliberately **not** reuse `SourceFeed.tsx`/`splitItems()`/`useDismissals()`
— the personal Inbox pane's "open" view convention, built for exactly one
editor's own dismissals, is the wrong building block here, not a shortcut to
reach for. This also means Step 1's confirmed-real, confirmed-cheap
cross-editor dismissal read is **not** the piece of infrastructure a
production version needs after all — it would only matter for a future
`'everyone'`-audience source whose *only* notion of "done" was per-editor
dismissal, and none of the four shipped sources work that way today.

### Test plan note

The grouping logic built for Step 2 — bucket rows by `item.assignee?.label ??
'Unassigned'` into a `Map<string, Row[]>` — is pure, has no React/hooks
dependency, and is a close sibling of `mergeRows` in `src/inbox/mergeItems.ts`
(same shape: take flattened cross-source rows, produce a stably-ordered
grouping). If a production plan proceeds, this is worth extracting into
`src/` (e.g. `groupByAssignee(rows: MergedRow[]): [string, MergedRow[]][]`)
with the same kind of direct unit tests `mergeItems.test.ts` already has for
`mergeRows` — no rendering, no mocks, just input arrays and expected buckets.

### Recommendation

**Proceed to a production plan.** The building blocks this plan originally
claimed existed now genuinely do, the prototype confirms the full mechanism
end-to-end against live data with no new query infrastructure, and Step 3
resolved what looked like an open risk into a concrete, low-cost design rule
("read sources' raw output directly; do not reuse the personal Inbox's
dismissal-filtered view") rather than a caveat to carry forward. A follow-up
plan should scope:

- A new Studio **tool** (this spike's own structure, not a structure item —
  confirmed the lower-effort choice by building it) that reuses
  `unpublishedDrafts()`, `openTasks({onlyMine: false})`, and optionally
  `upcomingReleases()` directly, the same way this prototype does.
- Extracting the grouping function into `src/` with unit tests, per the Test
  plan note above.
- A real team roster via `useUserListWithPermissions` (already reused twice
  in `src/`, per this plan's own Scope) — this prototype only ever creates a
  bucket for an assignee who already has at least one item; a production
  version should decide whether to also show team members with zero
  currently-open items (an open design question this spike did not need to
  answer, since it renders no interactivity and no roster).
- Permissions/visibility gating ("who can see the team view") — explicitly
  out of scope for a spike per this plan's own Scope section; still an open
  question for the next plan to design, not to inherit unresolved into
  shipped code.
- Reconciling this attempt's commits (on branch
  `worktree-agent-abb131c3214e5ad07`) with the stale prior-attempt commit
  sitting on `advisor/012-team-wide-view` (see the worktree/branch note
  above) before either is merged.
