# Plan 019: "Cleared" means Sanity said so — split resolution from acknowledgement

> **Executor instructions**: This plan touches the Inbox pane's core
> open/done/snoozed split — read "Why this matters" and every numbered
> "Decision" below in full before writing any code. Several of them settle
> real, previously-litigated design forks (recorded here, not left for you
> to re-derive) — follow them as written. Every step ends in a verification
> command — run it before moving on. If a STOP condition fires, stop and
> report rather than improvising. When done, update this plan's status row
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fe426b3..HEAD -- src/inbox/types.ts src/inbox/splitItems.ts src/inbox/Inbox.tsx src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx src/inbox/InboxRow.tsx src/inbox/InboxSection.tsx src/inbox/InboxStats.tsx src/inbox/sources/openTasks.ts src/inbox/sources/unpublishedDrafts.ts src/teamView/TeamViewTool.tsx src/i18n/locales/en-US.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (this is a trust/correctness fix — the Inbox pane can
  currently show "Done" for something that never actually changed)
- **Effort**: XL — this is the largest plan in this project's history;
  consider executing it as several separate commits/sessions along the
  step boundaries below rather than one sitting
- **Risk**: MEDIUM-HIGH (touches the core open/done/snoozed split every
  main and aside source flows through — `splitItems.ts` — plus the
  selection-bar action every "Mark as done" click in the whole pane
  routes through)
- **Depends on**: none (016/017/018 are all already shipped; 017 was
  built then reverted — irrelevant here)
- **Category**: direction (first plan from the 2026-09-14 planning
  session's "content status" discussion — see project memory for the
  full conversation this was extracted from)
- **Planned at**: commit `fe426b3`, 2026-09-14

## Why this matters

Today, clicking "Mark as done" always does the same two things regardless
of the source: it calls the source's `resolve` *if one exists*, then
**unconditionally** calls `dismissals.dismiss(...)` either way
(`MergedList.tsx`'s `confirmSelection`, quoted in full below). For
`openTasks` (which has a real `resolve`), that's fine — the task actually
closes. For `unpublishedDrafts`/`upcomingReleases` (no `resolve` — nothing
this plugin can do resolves a draft's *publish* state), "Mark as done"
only ever writes a per-editor dismissal. The draft is still unpublished.
Nothing in Sanity changed. The Inbox just says "Done."

That is precisely the trust problem the whole point of this plugin exists
to prevent: an editor sees a green checkmark and believes something is
settled, when the only thing that happened is *this one editor stopped
being reminded*. `InboxStats.tsx`'s "Cleared today" stat has the identical
bug — `countClearedToday` counts dismissals, any source, regardless of
whether anything real happened.

Plan 012's own investigation already found half of this, for the *team*
view specifically: *"cross-editor dismissal state turns out to be actively
wrong to fold in for `unpublishedDrafts`/`upcomingReleases` (neither has
`resolve`; a personal tick there was never global completion) and
unnecessary for `openTasks` (completion already lives on the task's own
`status`)."* This plan applies that same finding to the **personal** Inbox
pane, not just the team view — the same conflation exists there too, it
was just never named.

The fix, settled across a real design conversation (not guessed at here):
**"Cleared" must mean Sanity's own state actually changed. Anything else is
a personal "I've seen this" marker — "Acknowledged" — that never claims
resolution and never removes the item from view.**

## Decisions this plan makes, and why

1. **Rename the tab and the `InboxView` value: `'done'` → `'cleared'`,
   "Done" → "Cleared".** Code and UI language should agree, and "Cleared"
   was chosen specifically because it's the word `InboxStats.tsx` already
   uses (`stats.clearedToday`) — one word for one idea, not a third
   synonym alongside "Done"/"Resolved". This is a wider rename (every
   `view === 'done'` check, the tab id, i18n keys) than a pure string
   swap would be, but code and UI disagreeing about a state's name is
   exactly the kind of drift this whole plan exists to remove.

2. **"Cleared" only ever reflects a real, source-confirmed state change —
   never a dismissal.** Concretely: an item is cleared if and only if the
   *source itself* fetched it already-resolved and says so (a new
   `InboxItem.cleared?: boolean`, set only by a source that can verify it
   — see Decision 4). Dismissal never populates Cleared, for any source,
   ever.

3. **`openTasks` gets its query widened to also fetch recently-closed
   tasks; `unpublishedDrafts`/`upcomingReleases` do not, and cannot.**
   `openTasks.ts`'s `status == "open"` filter can simply be relaxed to
   also match `status == "closed"` within a recent window — `status` is a
   real, queryable field that persists after closing. `unpublishedDrafts`
   has no equivalent: once a draft publishes, its `drafts.<id>` document
   is gone — there is no field anywhere that says "this was a draft as of
   time X, now published," and no query can reconstruct that after the
   fact without a whole new change-tracking mechanism this plugin does
   not have. Building that tracking mechanism is explicitly **out of
   scope** for this plan (see Scope) — confirmed with the maintainer
   directly: drafts and releases simply never populate Cleared. They live
   in Open (optionally Acknowledged) or nowhere.

4. **`splitItems` stops taking `dismissals` as an input at all.** Its
   three-way split becomes: `item.cleared` → cleared; else snoozed →
   snoozed; else → open. Acknowledgement is *not* part of this split —
   it's a separate, per-row decoration (a badge), checked independently by
   whatever renders the row, using the exact same `isDismissed` function
   already in `store/dismissals.ts` (kept, unrenamed — see Decision 8).
   This is a genuine simplification, not just added complexity elsewhere:
   `splitItems` loses a parameter.

5. **Once acknowledged, if never actually resolved, the item stays in
   Open forever** (aside from Snooze, which is unaffected — see Decision
   9). Today, dismissing a no-`resolve` item makes it disappear (until
   the 90-day TTL). That "permanent make-it-go-away" option no longer
   exists for anything without real resolution. Confirmed directly and
   deliberately: *"Sanity is source of truth"* + *"editors need to know
   what they should work on"* both point the same way — if it's not
   actually fixed, it should keep nagging. This is the plan's biggest
   single visible behavior change; it is not an accident of the
   implementation, it is the point.

6. **For a source with real `resolve` (tasks): "Mark as done" is
   unchanged** — same button, same label, same action, already correct.
   **For a source with none (drafts, releases): the button reads
   "Acknowledge" instead**, and calls the same `dismissals.dismiss(...)`
   call as today (same code, new meaning) — but the row does **not**
   leave the list, gets no exit animation, and stays in Open with an
   acknowledged badge.

7. **A mixed selection (some rows resolvable, some not) still fires one
   button, doing both things for real**: resolvable rows get resolved
   (and will leave Open once the widened query confirms them cleared);
   non-resolvable rows get acknowledged in place. One click, two honest
   outcomes — not two buttons the editor has to choose between, and not
   silently picking one behavior for the whole batch.

8. **`useDismissals`/`dismiss()`/`restore()`/`DismissalState` keep their
   code names.** Only the UI-facing word changes ("Acknowledge", not
   "Dismiss"/"Done"). Renaming the underlying store/hook/type is a
   larger, code-only refactor with no user-visible benefit; deferred
   (see Maintenance notes) to keep this already-large plan's diff
   reviewable.

9. **Snoozing an item also acknowledges it**, so it doesn't read as
   "unseen" when it wakes back up into Open. Small, one-line addition to
   the snooze action; does not otherwise change how Snoozed works.

10. **`TeamViewTool.tsx` (plan 018) must filter out cleared items.** It
    calls each source's `useItems()` directly and flat-maps every
    `result.items` with no open/cleared distinction at all. Once
    `openTasks`'s query starts returning recently-closed tasks too (with
    `cleared: true`), the team view would start showing already-closed
    tasks mixed in with genuinely open ones unless this plan filters them
    out.

## Current state

**`src/inbox/types.ts:12`** — the value being renamed:

```ts
export type InboxView = 'open' | 'done' | 'snoozed'
```

**`src/inbox/types.ts:111-125`** (`InboxSourceResult`, unchanged by this
plan except for the doc comment) — the existing, already-correct
distinction this plan is finally making the UI honor:

```ts
export interface InboxSourceResult {
  items: InboxItem[]
  loading?: boolean
  error?: Error
  /**
   * Completes an item where it actually lives — closing a task, publishing a
   * draft.
   *
   * It is returned from the hook rather than declared on the source so it can
   * close over whatever that took: a client from `useClient`, a store, a
   * mutation hook. Omit it when the item has no completion this plugin can
   * perform. Ticking then only removes the item from this editor's own inbox,
   * and the UI says so rather than implying something changed for everyone.
   */
  resolve?: (item: InboxItem) => Promise<void>
```

**`src/inbox/splitItems.ts`** (whole file, 39 lines — the function this
plan rewrites):

```ts
import {isDismissed, type DismissalState} from '../store/dismissals'
import {isSnoozed, type SnoozeState} from '../store/snoozes'
import {type InboxItem} from './types'

export interface SplitItems {
  open: InboxItem[]
  done: InboxItem[]
  snoozed: InboxItem[]
}

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

**`src/inbox/MergedList.tsx`'s `confirmSelection`** (the exact bug this
plan fixes — dismiss always fires, whether or not `resolve` existed or
did anything):

```ts
const results = await Promise.allSettled(
  targets.map((row) => {
    const resolve = reports[row.sourceName]?.resolve
    return resolve ? resolve(row.item) : Promise.resolve()
  }),
)

let dismissedCount = 0
results.forEach((result, index) => {
  const row = targets[index]
  if (result.status === 'fulfilled') {
    dismissals.dismiss(row.sourceName, row.item.id)
    dismissedCount += 1
  } else {
    console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
  }
})
```

**`src/inbox/SelectionActions.tsx:59-80`** — `resolves` currently only
changes a tooltip, never the button label or behavior:

```tsx
const confirmLabel =
  view === 'done'
    ? t('action.markNotDone')
    : view === 'snoozed'
      ? t('action.wakeNow')
      : t('action.markDone')
```

```tsx
title={
  view === 'open'
    ? t(resolves ? 'action.markDone.resolves' : 'action.markDone.mine')
    : undefined
}
```

**`src/inbox/MergedList.tsx`'s `SelectionActions` invocation** — already
computes exactly the boolean this plan needs, just doesn't use it to gate
button behavior yet:

```tsx
resolves={selected.every((row) => Boolean(reports[row.sourceName]?.resolve))}
```

**`src/inbox/InboxRow.tsx`** — no per-row single-item action exists at
all; `done?: boolean` (line 17) is a pure display flag ("Already ticked
off. Only ever rendered while 'Show done' is on"), passed down from the
parent's `view === 'done'` check. All state-changing actions are bulk-only
via `MergedList`'s selection bar.

**`src/inbox/InboxSection.tsx`** (aside path) — has its **own inline**
dismiss/snooze split (not via `splitItems`), still fully branches on
`view === 'done'`/`'snoozed'`/else, with its own empty-state copy per
view (`source.noneDone`/`source.noneSnoozed`/`source.empty`). In practice
every aside source is invoked with `view="open"` only (this session's
earlier header redesign dropped bulk actions there) — this file is
**out of scope** for this plan (see Scope) precisely because it has no
selection mechanism to attach an Acknowledge action to.

**`src/inbox/InboxStats.tsx:85-93,126-129`** (`countClearedToday`, the
stat with the identical bug `MergedList`'s button has):

```ts
export function countClearedToday(dismissed: DismissalState['dismissed'], now: number): number {
  let count = 0
  for (const items of Object.values(dismissed)) {
    for (const at of Object.values(items)) {
      if (isToday(at, now)) count += 1
    }
  }
  return count
}
```
```ts
const clearedToday = useMemo(
  () => countClearedToday(dismissals.state.dismissed, now),
  [dismissals.state, now],
)
```

**`src/inbox/sources/openTasks.ts:82-91`** (`QUERY`, and the shared
`useTaskFetch` helper added this session for plan 016 — full current file
already read; only the query and the `items` mapping inside `useTaskFetch`
change):

```
*[
  _type == "tasks.task" &&
  status == "open" &&
  defined(title) &&
  ($assignedTo == null || assignedTo == $assignedTo)
] | order(coalesce(dueBy, _updatedAt) asc)[0...$limit]{
  _id, _updatedAt, title, dueBy, assignedTo,
  "targetId": target.document._ref,
  "targetType": target.documentType
}
```

**`src/teamView/TeamViewTool.tsx`** — reads every source's `useItems()`
directly and flat-maps `result.items` with no open/cleared filter:

```ts
const results = sources.map((source) => source.useItems())
const items = useMemo(() => results.flatMap((result) => result.items), [results])
```

**`src/i18n/locales/en-US.ts`** — exact keys this plan touches:

```ts
'tab.open': 'Open',
'tab.done': 'Done',
'tab.snoozed': 'Snoozed',
// ...
'source.empty': 'All clear.',
'source.noneDone': 'Nothing ticked off yet.',
'source.noneSnoozed': 'Nothing snoozed.',
// ...
'undo.markedDone_one': '{{count}} marked as done',
'undo.markedDone_other': '{{count}} marked as done',
// ...
'undo.done': 'Undone',
'action.markDone': 'Mark as done',
'action.markDone.mine': 'Removes it from your inbox. Nothing changes for anyone else.',
'action.markDone.resolves': 'Completes it for everyone, and removes it from your inbox.',
'action.markNotDone': 'Mark as not done',
// ...
'stats.clearedToday': 'Cleared today',
```

**Repo conventions to match**: see `plans/016-018-*.md` for the
`optionalHook`/`useSafely` pattern (unaffected here), the
`createInboxCountLayout`-style provider pattern (unaffected here), and
the pure-function-plus-colocated-test style `groupByAssignee.ts` and
`mergeItems.ts` both already use — `splitItems.ts` should keep matching
that style through this rewrite.

## Scope

**In scope**:
- `src/inbox/types.ts` — rename `InboxView`'s `'done'` to `'cleared'`; add
  `InboxItem.cleared?: boolean` (doc comment explains: set only by a
  source that can verify real resolution, e.g. `openTasks`; absent or
  `false` everywhere else, including every row from a source with no
  `resolve`).
- `src/inbox/splitItems.ts` (+ `splitItems.test.ts`) — drop the
  `dismissals` parameter; bucket by `item.cleared` → cleared, else
  snoozed, else open (rename the `done` bucket key to `cleared` in
  `SplitItems` too).
- `src/inbox/sources/openTasks.ts` — widen `QUERY` to also match recently
  closed tasks (new `OpenTasksOptions.clearedWithinDays`, default a small
  number — 7 is a reasonable starting point, matching this codebase's
  existing "recent window" defaults elsewhere), map those rows with
  `cleared: true`, `changedAt` from `_updatedAt` (already the case).
- `src/inbox/Inbox.tsx` — tab id/label rename (`DONE_TAB_ID` →
  `CLEARED_TAB_ID` or similar, `t('tab.done')` → `t('tab.cleared')`,
  `showDone`/`view === 'done'` → the `'cleared'` equivalents).
- `src/inbox/MergedList.tsx` — `confirmSelection`'s Open-view branch:
  split into "rows with `resolve`" (call it, for real) and "rows without"
  (call `dismissals.dismiss`, i.e. acknowledge, and do **not** add those
  rows' keys to `leavingKeys` — no exit animation, they stay). The
  Cleared-view branch (today's `'done'` branch, `dismissals.restore`) is
  unaffected in mechanism, just renamed.
- `src/inbox/SelectionActions.tsx` — compute and use a real
  "acknowledgeOnly" vs "resolves" vs "mixed" state to choose the Open-view
  button's label (`action.markDone` / `action.acknowledge` / a combined
  label for mixed — word this precisely in the step below) instead of
  `resolves` only affecting the tooltip.
- `src/inbox/InboxRow.tsx` — a new, independent "acknowledged" visual
  treatment (a small badge/dimming) shown on an **Open** row, driven by a
  new prop, separate from the existing `done` prop (which still means
  "in the Cleared view, render mutedly").
- `src/inbox/InboxStats.tsx` (+ `InboxStats.test.tsx`) — `countClearedToday`
  recomputed from real cleared rows (needs `clearedRows`/similar passed
  in alongside the existing `openRows`/`assignableRows`, filtered by
  `item.cleared && isToday(item.changedAt, now)`), not from
  `dismissals.state.dismissed`.
- `src/store/snoozes.ts`/`useSnoozes.ts` or wherever the snooze action is
  actually invoked (`MergedList.tsx`'s snooze handler) — also call
  `dismissals.dismiss(...)` for a snoozed row (Decision 9).
- `src/teamView/TeamViewTool.tsx` — filter `result.items` to
  `!item.cleared` before grouping (Decision 10).
- `src/i18n/locales/en-US.ts` — rename `tab.done`→`tab.cleared`,
  `source.noneDone`→`source.noneCleared`, add `action.acknowledge` (and
  whatever the mixed-selection label needs — see the Step below), update
  `undo.markedDone`/`undo.done` copy if the wording no longer fits an
  acknowledge-only action.
- `README.md` — a section (near the existing "Live updates"/"Reading the
  open count" material) explaining: Cleared only ever reflects real
  Sanity state; Acknowledge marks a row seen without claiming it's fixed;
  a source with no `resolve` never populates Cleared.
- `plans/README.md` — status row for this plan.

**Out of scope**:
- Any new change-tracking mechanism to let `unpublishedDrafts`/
  `upcomingReleases` populate Cleared — confirmed impossible without one,
  confirmed not worth building (Decision 3).
- Renaming `useDismissals`/`dismiss`/`restore`/`DismissalState` at the
  code level (Decision 8) — UI words change, the store's own names don't.
- `src/inbox/InboxSection.tsx` (aside rendering path) — no selection
  mechanism exists there to attach Acknowledge to; leave untouched.
- Any change to `openTasks`'s `resolve`/`assign` mechanics themselves, or
  to `unpublishedDrafts`'s `assess`/`assign` — this plan only changes what
  counts as Cleared and what Acknowledge means, not how a source actually
  performs a real completion.
- The 90-day dismissal TTL (`DISMISSAL_TTL_DAYS` in `store/dismissals.ts`)
  — unaffected; an acknowledgement can still age out the same way a
  dismissal did, no change needed to that mechanism.

## Git workflow

- Branch: `advisor/019-cleared-means-sanity-said-so`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period.
- Given this plan's Effort (XL), prefer committing (and, if useful,
  pausing) at each major step boundary below rather than one enormous
  commit — this repo's convention is small, reviewable commits even
  within one plan (see 016/018's own multi-commit history).
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |
| Dev       | `npm run dev`          | serves at `http://localhost:3333` — manual verification is load-bearing, see Step 9 |

## Steps

### Step 1: Add `InboxItem.cleared`, rename `InboxView`

In `src/inbox/types.ts`: change `InboxView` to `'open' | 'cleared' |
'snoozed'`. Add to `InboxItem` (near `changedAt`, same doc-comment style):

```ts
/**
 * True only when the *source itself* fetched this item already resolved
 * and can say so with real, Sanity-confirmed evidence (a task's own
 * `status`, say) — never set from a per-editor dismissal. Absent (or
 * `false`) for every item from a source with no `resolve`: there is
 * nothing this plugin can verify for those, so they are never cleared,
 * only ever open or acknowledged (see `useDismissals`).
 */
cleared?: boolean
```

Every other file referencing `'done'` as an `InboxView` value now has a
type error — that is the map of every remaining step in this plan; do not
silence it, work through each one.

**Verify**: `npm run typecheck` → lists every call site still needing the
rename (expected to fail at this step — this is a checkpoint, not a
regression).

### Step 2: Rewrite `splitItems`

```ts
import {isSnoozed, type SnoozeState} from '../store/snoozes'
import {type InboxItem} from './types'

export interface SplitItems {
  open: InboxItem[]
  cleared: InboxItem[]
  snoozed: InboxItem[]
}

/**
 * Splits one source's items into open/cleared/snoozed — purely from each
 * item's own data, never from per-editor dismissal state (see
 * `InboxItem.cleared`'s own doc comment for why). Cleared wins over
 * snoozed: an item Sanity itself confirms is resolved has no need to also
 * be asleep.
 */
export function splitItems(
  items: InboxItem[],
  sourceName: string,
  snoozes: SnoozeState,
  now: number,
): SplitItems {
  const open: InboxItem[] = []
  const cleared: InboxItem[] = []
  const snoozed: InboxItem[] = []

  for (const item of items) {
    if (item.cleared) {
      cleared.push(item)
    } else if (isSnoozed(snoozes, sourceName, item.id, now, item.changedAt)) {
      snoozed.push(item)
    } else {
      open.push(item)
    }
  }

  return {open, cleared, snoozed}
}
```

Update `splitItems.test.ts` to match: every existing "done" case becomes
a "cleared" case driven by `item.cleared: true` on the fixture instead of
constructing a `DismissalState`; drop the dismissal-construction test
helper entirely, add one case confirming an item with `cleared: true` and
also (hypothetically) snoozed still lands in `cleared` (cleared wins).

Every call site of `splitItems` (`SourceFeed.tsx`, `useOpenCount`
implementations in `unpublishedDrafts.ts`/`openTasks.ts`,
`InboxCountLayout`) drops its own `dismissals`/`dismissals.state`
argument — reads through this plan's typecheck-driven checklist from
Step 1.

**Verify**: `npm test -- splitItems` → all pass, then `npm run typecheck`
→ fewer errors than after Step 1 (every `splitItems` call site now
fixed).

### Step 3: Widen `openTasks`'s query

Add `clearedWithinDays?: number` to `OpenTasksOptions` (default `7`,
doc comment: "How far back a closed task still counts toward Cleared —
older closures simply age out of the query, the same way a dismissal
already ages out after `DISMISSAL_TTL_DAYS`"). Widen `QUERY`:

```
*[
  _type == "tasks.task" &&
  defined(title) &&
  ($assignedTo == null || assignedTo == $assignedTo) &&
  (
    status == "open" ||
    (status == "closed" && _updatedAt > $clearedSince)
  )
] | order(coalesce(dueBy, _updatedAt) asc)[0...$limit]{
  _id, _updatedAt, title, dueBy, assignedTo, status,
  "targetId": target.document._ref,
  "targetType": target.documentType
}
```

(`status` added to the projection; `$clearedSince` computed the same way
`unpublishedDrafts.ts`'s own `$before` already is —
`new Date(Date.now() - clearedWithinDays * 24 * 60 * 60 * 1000).toISOString()`.)

In `useTaskFetch`'s row-mapping (`TaskRow` gains `status: string`), set
`cleared: row.status === 'closed'` on the mapped `InboxItem`. Confirm
`$limit` still behaves sensibly with the widened result set — a `limit`
of 10 today caps *open* tasks; with cleared tasks now competing for the
same slots, consider (and document your choice either way) whether
`limit` should apply per-bucket or to the combined set — this is a real,
visible product decision, not a mechanical detail; do not silently pick
one without a comment explaining why.

**Verify**: `npm run typecheck` → exit 0 for this file. Manually confirm
(can defer to Step 9) that a closed task actually appears with
`cleared: true` once fetched.

### Step 4: Rename the tab everywhere

`Inbox.tsx`: `DONE_TAB_ID` → `CLEARED_TAB_ID` (keep the actual DOM id
string stable if anything external could depend on it — check for a
STOP condition if unsure), `showDone` → `showCleared`, every
`view === 'done'` → `view === 'cleared'`, `t('tab.done')` → `t('tab.cleared')`.

`en-US.ts`: `'tab.done': 'Done'` → `'tab.cleared': 'Cleared'`.
`'source.noneDone'` → `'source.noneCleared'` (keep the copy, "Nothing
ticked off yet." — re-read it against the new meaning; "ticked off" still
reads fine for a real resolution, keep it or improve it, your call, but
don't leave stale "done" language if you change the key).

`InboxSection.tsx`: its own inline `view === 'done'` branches and
`source.noneDone` reference rename the same way, even though (per Scope)
it gets no new Acknowledge behavior — it still needs to compile and read
correctly for the `view` prop it's always invoked with (`'open'` only
today, but the type and copy should still be consistent).

**Verify**: `npm run typecheck` → exit 0. `npm run lint` → exit 0 (catches
any stray `'done'` string literal `tsc` wouldn't).

### Step 5: Split resolve from acknowledge in `MergedList`'s `confirmSelection`

Replace the unconditional dismiss with:

```ts
const results = await Promise.allSettled(
  targets.map((row) => {
    const resolve = reports[row.sourceName]?.resolve
    return resolve ? resolve(row.item) : Promise.resolve()
  }),
)

let resolvedCount = 0
let acknowledgedCount = 0
results.forEach((result, index) => {
  const row = targets[index]
  if (result.status !== 'fulfilled') {
    console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
    return
  }
  const hasResolve = Boolean(reports[row.sourceName]?.resolve)
  if (hasResolve) {
    resolvedCount += 1
    // Real resolution — the widened query will confirm `cleared: true`
    // next fetch, so this row leaves via the normal leaving-animation
    // path already set up above.
  } else {
    dismissals.dismiss(row.sourceName, row.item.id)
    acknowledgedCount += 1
    // Acknowledged, not cleared — remove it from `leavingKeys` instead of
    // letting it animate away; it stays exactly where it is.
    setLeavingKeys((current) => {
      const next = new Set(current)
      next.delete(row.key)
      return next
    })
  }
})
```

(Adjust the exact shape to fit the surrounding function — this is the
core logic change, not a literal patch; the existing `leavingKeys`
add-then-remove dance around the animation needs the acknowledged rows
pulled back out *before* their fade would otherwise complete. Read the
whole `confirmSelection` function fresh before editing — it also handles
the Cleared-view "mark as not done" and Snoozed-view "wake now" branches,
untouched by this step except for the rename from Step 4.)

Two separate undo toasts (or one combined one, worded to cover both) —
your call, but do not silently drop the ability to undo an acknowledge
just because a resolve also happened in the same batch.

**Verify**: manual — mark a mixed selection (one task, one draft) as
done; confirm the task's row animates away and the draft's row stays put
with no animation. Full automated coverage comes in Step 8.

### Step 6: `SelectionActions`'s button label

Replace the `resolves: boolean` prop with something that distinguishes
three cases — "every selected row resolves", "no selected row resolves",
"mixed" — and choose `action.markDone` / a new `action.acknowledge` /
a new combined label accordingly for the Open view's confirm button.
Add the new i18n keys (`action.acknowledge`: "Acknowledge", and its own
tooltip explaining it marks the row seen without changing anything in
Sanity — mirror `action.markDone.mine`'s existing honesty). Keep
`action.markNotDone` and `action.wakeNow` (Cleared/Snoozed views)
unaffected in behavior, renamed only per Step 4 where the underlying
view name appears.

**Verify**: `npm run typecheck` → exit 0.

### Step 7: `InboxRow`'s acknowledged badge

Add an `acknowledged?: boolean` prop, independent of the existing `done`
prop (which stays scoped to "rendered in the Cleared view"). When true and
the row is otherwise in the Open view, show a small, unobtrusive
indicator (an outline checkmark, muted, next to the timestamp — match
this file's existing patterns for small inline indicators rather than
inventing a new one). `MergedList` passes this down per row using the same
`isDismissed` check `splitItems` used to do internally (imported directly
from `store/dismissals.ts`, unrenamed per Decision 8) — computed once per
render alongside the existing per-row props, not via a new hook.

**Verify**: `npm run typecheck` → exit 0. Manual: acknowledge a draft,
confirm the badge appears and the row stays in Open.

### Step 8: `InboxStats`'s `countClearedToday`, snooze-implies-acknowledge, `TeamViewTool` filter, tests

- `InboxStats.tsx`: change `countClearedToday`'s signature to take the
  actual cleared rows (`readonly MergedRow[]`, same shape `bucketByAge`
  already takes) and `now`, filtering `item.cleared && isToday(item.changedAt
  ?? '', now)` — `Inbox.tsx` needs to compute and pass a `clearedRows`
  equivalent to `openRows`/`assignableRows` today. Update
  `InboxStats.test.tsx`'s two `countClearedToday` cases to match the new
  signature and real-data semantics.
- Wherever `MergedList.tsx`'s snooze handler calls `snoozes.snooze(...)`,
  also call `dismissals.dismiss(...)` right alongside it (Decision 9) —
  one line, both stores already available in that scope.
- `TeamViewTool.tsx`: `results.flatMap((result) => result.items)` becomes
  `results.flatMap((result) => result.items.filter((item) => !item.cleared))`.
- Rewrite `MergedList.test.tsx`'s `'marks a mixed selection done, calling
  resolve only where the source has one'` case (currently asserts
  `dismissals.dismiss` called twice — once for the task, once for the
  draft) to instead assert: `resolve` called once (the task), `dismiss`
  called once (the draft only), and that the draft's row is *not* in
  whatever the test currently uses to detect "removed from view".
  Rework `InboxSection.test.tsx`'s `'splits open vs. done by changedAt'`
  case to construct `item.cleared` fixtures instead of dismissal state.

**Verify**: `npm test` → all pass (this is the step where every rewritten
test needs to actually pass together, not just typecheck).

### Step 9: Manual verification in `test-studio` (load-bearing)

1. `npm run build && npm run dev`, open the `default` workspace.
2. Close a real task (via its own row's "Mark as done", or externally)
   and confirm it appears in the **Cleared** tab within the configured
   `clearedWithinDays` window, with a real timestamp — not because it was
   dismissed.
3. Acknowledge a forgotten draft (the equivalent Open-view button, now
   labeled "Acknowledge"): confirm the row stays in Open, gets the
   acknowledged badge, does **not** move to Cleared, does **not**
   disappear.
4. Confirm the Cleared tab never shows a draft or release row, ever,
   regardless of how many are acknowledged.
5. Select a mixed batch (one closeable task, one draft) and confirm both
   halves of Step 5's behavior in the same click.
6. Snooze an open item; confirm that once it wakes back into Open, it
   already shows the acknowledged badge (Decision 9).
7. Open the Team tool (plan 018): confirm a task that was closed within
   the `clearedWithinDays` window does **not** appear there (Decision 10).
8. Confirm `InboxStats`'s "Cleared today" count matches only real
   resolutions from Step 2, not any acknowledged item.

**Verify**: describe what you observed in this plan's own commit
message(s) or a short note in your final report — this is the real,
end-to-end proof this plan works, not optional.

### Step 10: README, `plans/README.md`

Add a section explaining the Open/Cleared/Snoozed model and Acknowledge,
in plain terms matching this plan's own "Why this matters" — a consumer
reading the README should understand why a draft can never show as
Cleared without reading this plan file. Update `plans/README.md`'s status
table with this plan's row.

**Verify**: manually re-read for sense.

### Step 11: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- `splitItems.test.ts` — rewritten for `item.cleared`-driven bucketing,
  dismissals removed from its inputs entirely.
- `MergedList.test.tsx` — the mixed-selection case rewritten to assert
  resolve-vs-acknowledge split behavior precisely.
- `InboxSection.test.tsx` — the open/done-by-changedAt case rewritten
  against `item.cleared` fixtures.
- `InboxStats.test.tsx` — `countClearedToday` cases rewritten against
  real cleared-row fixtures.
- Step 9's manual verification is the real end-to-end proof and is not
  optional — no automated test exercises the widened GROQ query against
  a live dataset.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including every rewritten test named above
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "'done'" src/inbox/types.ts` finds nothing (the `InboxView`
  rename is complete)
- [ ] `grep -rn "dismissals" src/inbox/splitItems.ts` finds nothing (the
  parameter is fully removed)
- [ ] Step 9's manual verification performed and its result reported in
  full, covering all 8 numbered checks
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for this plan updated

## STOP conditions

Stop and report back (do not improvise) if:

- `openTasks.ts`'s `resolve`, or `unpublishedDrafts.ts`'s lack of one,
  have changed shape from what "Current state" quotes — this plan's core
  premise (Decision 3) rests on drafts genuinely having no verifiable
  resolution path.
- You find yourself wanting to build a change-tracking mechanism so
  drafts *can* populate Cleared — that is explicitly out of scope
  (Decision 3); report the temptation rather than building it.
- You find yourself wanting to give acknowledged-but-never-resolved items
  a way to permanently leave Open — that is Decision 5, deliberately the
  point of this whole plan; report the temptation rather than adding one.
- The widened `openTasks` query's `limit` behavior (Step 3) feels wrong
  once you see it against real data and you're unsure which way to
  resolve it — report the two options and what you observed, rather than
  guessing silently.
- A rewritten test in Step 8 cannot be made to pass without weakening
  what it actually asserts — report which one and why, rather than
  shipping a test that no longer catches the bug it exists to catch.

## Maintenance notes

- `useDismissals`/`dismiss`/`restore`/`DismissalState` keep their original
  names throughout this plugin's code, deliberately (Decision 8) — a
  future cleanup pass could rename them to `useAcknowledgements`/
  `acknowledge`/`unacknowledge`/`AcknowledgementState` for full
  code/product-language alignment, but that is a larger, lower-value,
  separate refactor; do not fold it into this plan.
- `unpublishedDrafts`/`upcomingReleases` never populating Cleared is a
  permanent architectural fact, not a gap to revisit casually — see
  Decision 3's reasoning before ever proposing to change it.
- The `clearedWithinDays` window (Step 3) is the only place a "recently
  resolved" item can silently age back out of visibility — if a future
  session wants a persistent, non-aging record of what got resolved, that
  is a real digest/reporting feature (see `buildDigest` in `src/digest.ts`
  for this plugin's existing pattern for that kind of thing), not
  something to bolt onto the live Cleared tab.
