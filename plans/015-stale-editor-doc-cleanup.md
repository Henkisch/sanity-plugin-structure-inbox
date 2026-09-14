# Plan 015: A pure helper (and README recipe) for finding departed editors' leftover state

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 32e028c..HEAD -- src/index.ts src/store/useDismissals.ts src/store/useSnoozes.ts src/store/useTodos.ts README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (pure function, no I/O, no change to any existing export or
  behavior — purely additive)
- **Depends on**: none
- **Category**: direction (found during a lifecycle-focused `/improve` pass,
  2026-09-13)
- **Planned at**: commit `32e028c`, 2026-09-13

## Why this matters

Every editor who ever dismisses something, snoozes something, or adds a todo
gets a document of their own in the *customer's* dataset —
`structureInbox.dismissals.<userId>`, `structureInbox.snoozes.<userId>`,
`structureInbox.todos.<userId>` (`src/store/useDismissals.ts`,
`src/store/useSnoozes.ts`, `src/store/useTodos.ts` — all three follow the
identical `${TYPE}.<sanitized-user-id>` naming scheme). Nothing ever deletes
one. Over a project's real, multi-year life, team composition changes —
people leave, contractors roll off, accounts get deactivated — and every one
of them leaves a small document behind forever. There is currently no
plugin-provided or documented way for a maintainer to even find these, let
alone clean them up.

This is a different concern from the existing "Findings considered and
rejected" privacy note in `plans/README.md` (which is about *who can read* an
*active* editor's dismissal history) — this is about *unbounded accumulation*
specifically from editors who are no longer even on the project, with zero
built-in visibility into how many such orphaned documents exist.

This plugin already has an established answer for "a real capability, but one
this npm package shouldn't ship as automated behavior": the digest recipe
(`README.md`'s "Recipe: a digest outside the Studio", and `src/digest.ts`'s
`buildDigest`) — export one small, pure, dependency-free function that does
the hard part (the diff), and let the *cadence and the actual deletion* stay
the caller's own decision, exactly like the digest recipe already does for
"fetch and send." Automatically deleting a document based on a static list
this plugin can't independently verify is current would be the wrong kind of
feature to *actually run automatically* inside the plugin itself.

## Current state

**`src/store/useDismissals.ts:16-23, 39-41`** — the exact naming scheme this
plan's helper has to parse back apart:

```ts
/**
 * The document type dismissals are stored in.
 *
 * Deliberately never registered in the Studio schema: it is a preference, not
 * content, and an editor should not meet it in the structure tool, in search,
 * or in a reference picker. Writing an unregistered type through the client is
 * supported; only the Studio's own UI cares about registration.
 */
const DISMISSALS_TYPE = 'structureInbox.dismissals'

/** Document ids allow a limited alphabet, and user ids are opaque strings. */
function dismissalsDocumentId(userId: string): string {
  return `${DISMISSALS_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}
```

`src/store/useSnoozes.ts` and `src/store/useTodos.ts` each follow this exact
same shape, with their own type constant (`structureInbox.snoozes`,
`structureInbox.todos`) and an identically-named-in-spirit
`snoozesDocumentId`/`todosDocumentId` function — confirm this directly by
reading both files before writing Step 1's code (line numbers may differ
slightly from this plan's citations above; the *shape* — `` `${TYPE}.${sanitized(userId)}` ``
— is what must match).

Already investigated and settled, in `plans/README.md`'s "Findings
considered and rejected": *"two users collide only if their Sanity ids differ
solely in characters outside `[A-Za-z0-9._-]`, which current Sanity id
formats never produce."* This plan's helper relies on the same fact in
reverse — stripping the `${TYPE}.` prefix off a document id recovers the
original user id exactly, for every real Sanity user id, because the
sanitization regex is a no-op on the character set Sanity actually uses.

**`src/index.ts`** (whole file, for the exact export-grouping convention this
plan's new export joins):

```ts
export {DEFAULT_TOOL_NAME, INBOX_PANE_ID, STRUCTURE_INBOX_NAMESPACE} from './constants'
export {structureInbox} from './plugin'
export {inboxListItem} from './structure/inboxNode'
export type {StructureInboxConfig} from './types'

export type {InboxItem, InboxSource, InboxSourceResult} from './inbox/types'
export {openTasks, type OpenTasksOptions} from './inbox/sources/openTasks'
export {todos, type TodosOptions} from './inbox/sources/todos'
export {unpublishedDrafts, type UnpublishedDraftsOptions} from './inbox/sources/unpublishedDrafts'
export {upcomingReleases, type UpcomingReleasesOptions} from './inbox/sources/upcomingReleases'

export {SectionCard} from './ui/SectionCard'

// Pure, dependency-free reads of the plugin's own per-editor documents — no
// React, no Studio context. Exported for code that reads these documents
// outside a Studio, such as a Sanity Function building a digest with
// `buildDigest` — see "Recipe: a digest outside the Studio" in the README.
export {isDismissed, parseDismissals, type DismissalState} from './store/dismissals'
export {isSnoozed, parseSnoozes, type SnoozeState} from './store/snoozes'
export {parseTodos, type TodoItem, type TodosState} from './store/todos'
export {buildDigest, type DigestEditor, type DigestSource, type EditorDigest} from './digest'
```

**`src/digest.ts`** (whole file — the sibling this plan's new file matches in
size, shape, and "pure function, caller fetches" contract):

```ts
import {type DismissalState} from './store/dismissals'
import {type SnoozeState} from './store/snoozes'
import {type InboxItem} from './inbox/types'
import {splitItems} from './inbox/splitItems'

export interface DigestSource {
  name: string
  items: InboxItem[]
}

export interface DigestEditor {
  userId: string
  dismissals: DismissalState
  snoozes: SnoozeState
}

export interface EditorDigest {
  userId: string
  open: InboxItem[]
}

export function buildDigest(
  sources: DigestSource[],
  editors: DigestEditor[],
  now = Date.now(),
): EditorDigest[] {
  return editors.map((editor) => ({
    userId: editor.userId,
    open: sources.flatMap(
      (source) => splitItems(source.items, source.name, editor.dismissals, editor.snoozes, now).open,
    ),
  }))
}
```

**`README.md:325-350`** — the digest recipe section this plan's new recipe
sits next to, matching its exact framing ("this intentionally stays a recipe
rather than shipped code"):

```md
### Recipe: a digest outside the Studio

Nothing this pane shows is private to it — `structureInbox.dismissals.<userId>`,
`structureInbox.snoozes.<userId>` and `structureInbox.todos.<userId>` are
plain, queryable documents in your dataset. That makes a scheduled digest (a
daily "here's what's still open" email or Slack message) a job for a
[Sanity Function](https://www.sanity.io/docs/content-lake/webhooks) — a
separate deployable in your Studio project, not something this npm package
ships or can install for you.

Sketch of what such a Function does, run on a schedule rather than a document
event — fetch stays your own code, but working out what's still open is one
call to `buildDigest`, exported from `sanity-plugin-structure-inbox` for
exactly this, pure and dependency-free, no Studio context required:

​```ts
import {buildDigest, parseDismissals, parseSnoozes} from 'sanity-plugin-structure-inbox'

const editors = await fetchEditorsWithParsedState(client) // your own fetch + parseDismissals/parseSnoozes per editor
const sources = await fetchConfiguredSourceItems(client)  // your own fetch, shaped as {name, items}[]

const digests = buildDigest(sources, editors)
// digests: {userId, open: InboxItem[]}[] — send however you'd like; the Function is plain Node.js, so any email or chat API works.
​```

This intentionally stays a recipe rather than shipped code: a digest's cadence, channel and formatting are product decisions for your Studio, not this plugin's to make.
```

**Repo conventions to match**:

- One small, focused file per concern — see `src/digest.ts` (46 lines).
  This plan's new file should be similarly sized.
- JSDoc explains *why*, not *what* — see `buildDigest`'s own doc comment.
- Tests live beside the module — `src/digest.test.ts` sits next to
  `src/digest.ts`. Same layout for this plan's new module.
- A recipe in the README, not shipped automation — see the whole digest
  recipe section quoted above; this plan's new section should read the same
  way (a sketch the reader adapts, explicit about what stays their call).

## Scope

**In scope**:
- `src/staleEditorDocs.ts` (create) — the new pure diff function and its
  types.
- `src/staleEditorDocs.test.ts` (create) — unit tests.
- `src/index.ts` — add the new export(s), in the same "pure, dependency-free
  reads" group as `buildDigest`.
- `README.md` — a new recipe section, immediately after "Recipe: a digest
  outside the Studio" (`README.md:325-350`), before `## Options`
  (`README.md:352`).

**Out of scope**:
- Any actual deletion, cron job, or Sanity Function code — same boundary
  `buildDigest` draws: this plan ships a pure **library function**, not a
  deployable, and not automated cleanup. The README recipe shows a sketch;
  it is not runnable as-is and should not pretend to be.
- Fetching the *active* user list — `useUserListWithPermissions` (already
  used inside `unpublishedDrafts.ts`/`openTasks.ts`) or Sanity's project
  members API are the caller's own concern; this plan's function takes that
  list as a plain argument, it does not fetch it.
- Changing `dismissalsDocumentId`/`snoozesDocumentId`/`todosDocumentId` or
  the naming scheme itself in any of the three store files — this plan reads
  and parses the existing scheme, it does not touch it.
- Any UI surface (no button, no tool, no pane) — this is a maintainer-run
  recipe, like the digest, not a feature editors ever see.

## Git workflow

- Branch: `advisor/015-stale-editor-doc-cleanup`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period: e.g. `feat: add a helper for finding departed
  editors' leftover inbox state`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |

## Steps

### Step 1: Read the three document-id functions to confirm the shared shape

Before writing any code, read `src/store/useDismissals.ts`,
`src/store/useSnoozes.ts`, and `src/store/useTodos.ts` in full. Confirm each
has:
- A `const <NAME>_TYPE = 'structureInbox.<name>'` constant.
- A `<name>DocumentId(userId: string): string` function returning
  `` `${<NAME>_TYPE}.${userId.replace(/[^a-zA-Z0-9._-]/g, '-')}` ``.

If any of the three differs from this shape (a different sanitization regex,
a different separator), treat it as a STOP condition — this plan's helper
assumes all three are structurally identical, differing only in the type
constant.

**Verify**: no command — this is a read-and-confirm step.

### Step 2: Write the diff function

Create `src/staleEditorDocs.ts`:

```ts
/** The three document types this plugin ever writes for an editor's own state. */
export const EDITOR_DOC_TYPES = [
  'structureInbox.dismissals',
  'structureInbox.snoozes',
  'structureInbox.todos',
] as const

/** One of this plugin's own per-editor documents, as returned by a GROQ query. */
export interface EditorDocRef {
  _id: string
  _type: string
}

/**
 * Which of this plugin's own per-editor documents belong to a user id not in
 * `activeUserIds`.
 *
 * A document's own id is `${_type}.${sanitizedUserId}` (see
 * `dismissalsDocumentId`/`snoozesDocumentId`/`todosDocumentId` in
 * `src/store/`) — stripping the `${_type}.` prefix recovers the original user
 * id exactly, for every real Sanity user id, since the sanitization those
 * functions apply is a no-op on the character set Sanity actually uses (see
 * `plans/README.md`'s "Lossy user-id → document-id mapping" entry).
 *
 * Pure — this function does no fetching of either list. The caller supplies
 * both: the documents via `*[_type in $types]` naming `EDITOR_DOC_TYPES`, and
 * the active user ids via `useUserListWithPermissions` or Sanity's project
 * members API — whichever fits their own Studio's setup. This function only
 * decides which documents are now orphaned; deleting them, and on what
 * schedule, is the caller's own decision, the same way `buildDigest` leaves
 * "fetch" and "send" to its caller.
 */
export function findStaleEditorDocuments(
  docs: readonly EditorDocRef[],
  activeUserIds: readonly string[],
): string[] {
  const active = new Set(activeUserIds)

  return docs
    .filter((doc) => {
      const userId = doc._id.slice(doc._type.length + 1)
      return userId.length > 0 && !active.has(userId)
    })
    .map((doc) => doc._id)
}
```

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 3: Export it

Add to `src/index.ts`, in the same group `buildDigest` is in, updating that
group's comment to mention this function too:

```ts
export {
  EDITOR_DOC_TYPES,
  findStaleEditorDocuments,
  type EditorDocRef,
} from './staleEditorDocs'
```

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Write tests

Create `src/staleEditorDocs.test.ts`, modeled on `src/digest.test.ts`'s
fixture style (small object literals, no store hooks). Cover:

- A document whose user id is in `activeUserIds` is not returned.
- A document whose user id is *not* in `activeUserIds` is returned, exactly
  as its own `_id`.
- All three document types (`dismissals`/`snoozes`/`todos`) are handled
  identically — a fixture with one of each, same user id, either all three
  are flagged (inactive) or none are (active) — proves the prefix-stripping
  is `_type`-aware, not hardcoded to one type.
- An empty `docs` array, or an empty `activeUserIds` array (every doc is
  stale), both behave sanely (no throw).
- A user id itself containing a literal `.` (a real, if unusual, Sanity id
  shape — the sanitization regex allows `.`) still round-trips: pick a
  fixture id with a `.` in it, in `activeUserIds`, and confirm its document is
  correctly recognized as *not* stale (this is the one case where a naive
  "split on the first `.`" approach would break; the `slice(doc._type.length + 1)`
  approach in Step 2 does not have this problem — the test should prove that,
  not just assume it).

**Verify**: `npm test -- staleEditorDocs` → all new tests pass.

### Step 5: Add the README recipe

Immediately after the existing "Recipe: a digest outside the Studio" section
(ends at `README.md:350`, right before `## Options` at `README.md:352`), add
a new section:

```md
### Recipe: cleaning up after a departed editor

`structureInbox.dismissals.<userId>`, `.snoozes.<userId>` and
`.todos.<userId>` persist forever once created — nothing in this plugin ever
deletes one, even for an editor no longer on the project. Over a project's
life this adds up to real, if small, unbounded storage growth with no
built-in way to find or reclaim it.

`findStaleEditorDocuments`, exported for exactly this, is the diff — you
supply both lists, it tells you which documents are now orphaned:

​```ts
import {EDITOR_DOC_TYPES, findStaleEditorDocuments} from 'sanity-plugin-structure-inbox'

const docs = await client.fetch(`*[_type in $types]{_id, _type}`, {types: EDITOR_DOC_TYPES})
const activeUserIds = await fetchCurrentProjectMemberIds() // your own fetch, e.g. Sanity's project members API

const staleIds = findStaleEditorDocuments(docs, activeUserIds)
// staleIds: string[] — delete however and whenever you like, e.g.:
// await client.delete({query: '*[_id in $ids]', params: {ids: staleIds}})
​```

Run this whenever suits your project — a one-off cleanup, or a scheduled
Sanity Function alongside the digest recipe above. This stays a recipe, not
automated behavior, deliberately: this plugin has no independent way to
verify your project's current membership, so it should never delete a
document on your behalf without you supplying and reviewing that list
yourself.
```

**Verify**: manually re-read the added section; confirm every referenced
export (`EDITOR_DOC_TYPES`, `findStaleEditorDocuments`) actually exists in
`src/index.ts` after Step 3.

### Step 6: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- New file: `src/staleEditorDocs.test.ts`, cases listed in Step 4.
- Pattern to follow: `src/digest.test.ts` (read it before writing — same
  `describe`/`it` structure, same plain-object-literal fixture style).
- Verification: `npm test` → all pass, including the new file's tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `src/staleEditorDocs.test.ts` exists with the 5
  cases from Step 4, all passing
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "findStaleEditorDocuments" src/index.ts` finds the new export line
- [ ] `README.md` contains a "Recipe: cleaning up after a departed editor"
  heading
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the three document-id functions (`dismissalsDocumentId`,
  `snoozesDocumentId`, `todosDocumentId`) doesn't match the shared
  `${TYPE}.${sanitized(userId)}` shape this plan assumes (see Step 1).
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself wanting to add a Sanity client, an HTTP call, a project
  members API call, or any network I/O to `src/staleEditorDocs.ts` — that
  would break the "pure function, caller fetches both lists" contract this
  whole plan rests on. Stop instead of adding it.
- You find yourself wanting to add a delete/mutation helper (something that
  actually calls `client.delete(...)`) as a shipped export — the README
  recipe shows that line as a sketch precisely so it stays the caller's own,
  reviewed decision; exporting a function that performs the delete itself is
  out of scope, not a natural extension.

## Maintenance notes

- If this plugin ever adds a fourth per-editor document type, add its type
  string to `EDITOR_DOC_TYPES` and nothing else needs to change —
  `findStaleEditorDocuments` is generic across whatever `_type` each document
  actually carries.
- A reviewer should confirm `findStaleEditorDocuments` never imports from
  `sanity` or `@sanity/client`, matching `buildDigest`'s existing
  zero-dependency contract (see that function's own maintenance note in
  `src/digest.ts`'s history / `plans/010-export-digest-builder.md`).
- This plan does not address *why* a departed editor's document exists in the
  first place (nothing currently offboards it at the moment someone leaves) —
  only how to find and clear it after the fact. An automatic
  offboarding hook would be a much larger, different plan (it would need to
  react to project-membership changes, which this plugin has no visibility
  into today) and is explicitly not what this plan attempts.
