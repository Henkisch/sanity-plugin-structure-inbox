# Plan 010: Export a `buildDigest` function so the README's digest recipe stops being copy-paste

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2218e06..HEAD -- src/inbox/splitItems.ts src/store/dismissals.ts src/store/snoozes.ts src/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2218e06`, 2026-09-13

## Why this matters

`README.md:325-342` documents a "Recipe: a digest outside the Studio" — a
scheduled email/Slack message listing what's still open across the team. The
README is explicit that this "intentionally stays a recipe rather than
shipped code", and names the exact building blocks a caller needs:
`isDismissed`/`isSnoozed` (`README.md:339`), already exported "for exactly
this". Everything the recipe describes already exists as pure, exported
functions (`src/index.ts:18-20` exports `isDismissed`, `isSnoozed`, and
`parseTodos`/`parseDismissals`/`parseSnoozes` too) — what's missing is the one
function that wires them together across every configured source and every
editor. Right now, building a digest means re-deriving that wiring from
scratch by reading the README's prose sketch. This plan turns the sketch into
a single exported function, so a Sanity Function author writes a fetch and a
send, and nothing else.

This is the single highest-confidence, lowest-effort item in a wider
"feel on top of your content" investigation — everything it needs is already
built and already exported; this plan only adds the one function that
connects them.

## Current state

The three pieces this plan combines, as they exist today:

**`src/inbox/splitItems.ts`** — the exact per-source, per-editor
classification the digest needs, already used by every rendering path
(`InboxSection`, `SourceFeed`) so a digest built on it can never disagree with
what the pane itself shows:

```ts
// src/inbox/splitItems.ts:20-42
export function splitItems(
  items: InboxItem[],
  sourceName: string,
  dismissals: DismissalState,
  snoozes: SnoozeState,
  now: number,
): SplitItems {
  const open: InboxItem[] = []
  const done: InboxItem[] = []
  const snoozed: InboxItem[] = []

  for (const item of items) {
    if (isDismissed(dismissals, sourceName, item.id, item.changedAt)) {
      done.push(item)
    } else if (isSnoozed(snoozes, sourceName, item.id, now, item.changedAt)) {
      snoozed.push(item)
    } else {
      open.push(item)
    }
  }

  return {open, done, snoozed}
}
```

`SplitItems` (same file) is `{open: InboxItem[]; done: InboxItem[]; snoozed: InboxItem[]}`.

**`src/index.ts`** — the current public surface (this is the whole file):

```ts
// src/index.ts
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
// outside a Studio, such as a Sanity Function building a digest — see
// "Recipe: a digest outside the Studio" in the README.
export {isDismissed, parseDismissals, type DismissalState} from './store/dismissals'
export {isSnoozed, parseSnoozes, type SnoozeState} from './store/snoozes'
export {parseTodos, type TodoItem, type TodosState} from './store/todos'
```

Note `splitItems` itself is **not** currently exported from `index.ts` — it's
an internal helper of `src/inbox/`. `buildDigest` will live outside
`src/inbox/` (see Scope) and import `splitItems` directly from
`../inbox/splitItems` — a normal internal cross-module import within this one
package, not a new public export. Only `buildDigest` itself needs to be
public.

**`README.md:325-342`** — the exact three-step sketch this plan turns into
code (quoted in full, since the executor must match this shape):

> 1. Fetch each editor's dismissals/snoozes/todos documents
>    (`*[_type == "structureInbox.dismissals"]`, etc.) alongside whatever your
>    sources actually query (drafts, tasks, releases).
> 2. For each editor, apply `isDismissed` / `isSnoozed` — exported from
>    `sanity-plugin-structure-inbox` for exactly this, pure and
>    dependency-free, no Studio context required — to work out what is still
>    genuinely open for them right now.
> 3. Send whatever is left, however you'd send it — the Function is plain
>    Node.js, so any email or chat API works.

**Repo conventions to match**:

- One small, focused file per concern — see `src/inbox/splitItems.ts` (42
  lines) and `src/structure/resolveConfig.ts` (18 lines). This plan's new file
  should be similarly sized; do not fold it into an existing file.
- JSDoc comments explain *why*, not *what* — see the comment above
  `splitItems` for the house style (one paragraph, states a non-obvious
  design decision, no restating the code).
- Tests live beside the module: `src/inbox/splitItems.test.ts` sits next to
  `splitItems.ts`. Follow the same layout for the new module and its test.
- Exports are named, grouped by concern, with a one-line comment on the group
  — see the "Pure, dependency-free reads" comment block above.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`            | all pass             |
| Lint      | `npm run lint`        | exit 0               |
| Build     | `npm run build`       | exit 0               |

All verified present in `package.json` (`scripts` block) during recon —
run from the repo root, not `test-studio/`.

## Scope

**In scope** (the only files you should modify or create):
- `src/digest.ts` (create) — the new `buildDigest` function and its types.
- `src/digest.test.ts` (create) — unit tests.
- `src/index.ts` — add the new export(s).
- `README.md` — replace the "Recipe" section's three-step prose with a
  shorter one that calls `buildDigest`, keeping the "this is a recipe, not a
  shipped Function" framing (channel/cadence is still the caller's call).

**Out of scope** (do NOT touch, even though they look related):
- `src/inbox/splitItems.ts` — import it, do not modify it. It's used by live
  rendering paths (`SourceFeed`, `InboxSection`); any behavior change there
  changes what editors see in the pane itself, which is not this plan's
  concern.
- Any actual Sanity Function, webhook, or scheduled-job code — this plan ships
  a **library function**, not a deployable. Do not add a `test-studio`
  function or cron config.
- Todos: see Step 1 for why `buildDigest` does not need to accept them at all.

## Git workflow

- Branch: `advisor/010-export-digest-builder`
- Commit per step; message style matches `git log` on this repo — imperative,
  lowercase type prefix, no period: e.g. `feat: export a buildDigest helper
  for the README's digest recipe`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Design the function signature

`buildDigest` takes every configured source's **already-fetched** items (this
function has no client of its own — the README's step 1, "fetch", stays the
caller's job, same as it is today) plus every editor's parsed state, and
returns each editor's still-open items.

Todos are deliberately **not** part of the input: a todo is a personal
scratch list (`README.md:88-90` — "always yours... no 'everyone's' reading"),
so it has no place in a team-facing "what's still open" digest. If the
codebase's later direction wants a personal digest that includes todos, that
is a different function; don't fold it into this one speculatively.

Create `src/digest.ts`:

```ts
import {isDismissed, type DismissalState} from './store/dismissals'
import {isSnoozed, type SnoozeState} from './store/snoozes'
import {type InboxItem} from './inbox/types'
import {splitItems} from './inbox/splitItems'

/** One configured source's name and its currently-fetched items. */
export interface DigestSource {
  /** Must match the `sourceName` `isDismissed`/`isSnoozed` were recorded against — the same `source.name` passed to `structureInbox({sources: [...]})`. */
  name: string
  items: InboxItem[]
}

/** One editor's parsed per-editor state — the output of `parseDismissals`/`parseSnoozes` on their own documents. */
export interface DigestEditor {
  userId: string
  dismissals: DismissalState
  snoozes: SnoozeState
}

/** What's still open for one editor, across every source. */
export interface EditorDigest {
  userId: string
  open: InboxItem[]
}

/**
 * Builds each editor's "what's still open" list — the same open/done/snoozed
 * split every rendered inbox uses (`splitItems`), run once per editor across
 * every source, with nothing kept but what's still open. Whether "open"
 * counts snoozed-but-not-yet-woken items is the caller's call — this
 * function only reports fully open ones, matching what the pane's own
 * headline count already treats as "waiting on you" (see `Inbox.tsx`'s
 * `openCount`, which sums only `.open`, never `.snoozed`).
 */
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

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Export it

Add to `src/index.ts`, in the same "pure, dependency-free reads" group as
`isDismissed`/`isSnoozed`/`parseTodos` (update that group's existing comment
to mention `buildDigest` by name rather than only the two lower-level
functions):

```ts
export {buildDigest, type DigestEditor, type DigestSource, type EditorDigest} from './digest'
```

**Verify**: `npm run typecheck` → exit 0. Then confirm the export actually
resolves from the package entry point: `node -e "console.log(typeof require('./dist/index.js').buildDigest)"`
will not work pre-build (ESM, and `dist/` is stale until Step 5) — skip this
check here and rely on Step 5's build instead.

### Step 3: Write tests

Create `src/digest.test.ts`, modeled on `src/inbox/splitItems.test.ts` (read
it first for the fixture-construction style — small `DismissalState`/
`SnoozeState` object literals, not the full store hooks).

Cover:
- An item dismissed by editor A but not editor B appears in B's digest, not A's.
- An item snoozed for an editor is excluded from their digest (matches
  `splitItems`' `snoozed` bucket being excluded).
- Two sources' items are combined into one editor's `open` list.
- An editor with no dismissals/snoozes at all (`EMPTY_DISMISSALS`/
  `EMPTY_SNOOZES`, exported from `src/store/dismissals.ts` /
  `src/store/snoozes.ts`) sees everything as open.
- Zero editors or zero sources returns `[]` / editors with empty `open`,
  not a throw.

**Verify**: `npm test -- digest` → all new tests pass.

### Step 4: Update the README recipe

Replace the three-numbered-step prose at `README.md:325-342` with a version
that calls `buildDigest` directly. Keep the surrounding framing sentence
("This intentionally stays a recipe rather than shipped code...") — the
channel (email/Slack/etc.) is still not this plugin's decision, only the
"figure out what's still open" wiring changes.

Sketch (adapt to match the surrounding prose style, don't paste verbatim):

```ts
import {buildDigest, parseDismissals, parseSnoozes} from 'sanity-plugin-structure-inbox'

const editors = await fetchEditorsWithParsedState(client) // your own fetch + parseDismissals/parseSnoozes per editor
const sources = await fetchConfiguredSourceItems(client)  // your own fetch, shaped as {name, items}[]

const digests = buildDigest(sources, editors)
// digests: {userId, open: InboxItem[]}[] — send however you like.
```

**Verify**: manually re-read the updated section; confirm every referenced
export (`buildDigest`, `parseDismissals`, `parseSnoozes`) actually exists in
`src/index.ts` after Step 2.

### Step 5: Full verification

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- New file: `src/digest.test.ts`, cases listed in Step 3.
- Pattern to follow: `src/inbox/splitItems.test.ts` (read it before writing —
  same fixture shapes, same `describe`/`it` structure this repo uses
  throughout `src/**/*.test.ts`).
- Verification: `npm test` → all pass, including the new file's tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `src/digest.test.ts` exists with the 5 cases from Step 3, all passing
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "buildDigest" src/index.ts` finds the new export line
- [ ] `README.md`'s digest section no longer contains the old three-numbered-list prose verbatim (it now shows `buildDigest` in the sketch)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/inbox/splitItems.ts`'s signature has changed from the "Current state"
  excerpt above (the digest builder's whole design rests on reusing it
  unmodified).
- `DismissalState`/`SnoozeState` are no longer exported from
  `src/store/dismissals.ts` / `src/store/snoozes.ts`.
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself wanting to add a Sanity client, an HTTP call, or any
  network I/O to `src/digest.ts` — that would break the "pure function,
  caller fetches" contract this whole plan rests on. Stop instead of adding it.

## Maintenance notes

- If a fifth built-in source is ever added, `buildDigest` needs no changes —
  it's shape-agnostic across sources (`DigestSource[]`). Only the caller's own
  fetch code (outside this package) needs to know about a new source.
- If todos ever need their own digest treatment, add a **second** function
  rather than an optional parameter on this one — keeps "team digest" and
  "personal digest" as separately reasoned-about concerns, matching how
  `audience: 'mine' | 'everyone'` already separates them elsewhere in this
  codebase (see `src/inbox/types.ts`'s `InboxSource.audience`).
- A reviewer should check that `buildDigest` never imports anything from
  `sanity` or `@sanity/client` — the whole point is that it runs in a plain
  Node.js Sanity Function with no Studio context, matching `isDismissed`/
  `isSnoozed`'s existing zero-dependency contract.
