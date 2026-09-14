# Plan 001: Make "Mark as done" stick for items with a future timestamp

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 30e3782..HEAD -- src/store/dismissals.ts src/inbox/types.ts src/inbox/sources src/inbox/InboxSection.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e3782`, 2026-09-09

## Why this matters

This plugin's headline interaction is: select an item, click "Mark as done", it
moves to the Done tab. For two of the three shipped sources that silently does
not work. The item's checkbox clears and the row stays in Open forever.

The cause is that one field, `InboxItem.timestamp`, is doing two incompatible
jobs. `isDismissed` treats it as "when this item last changed" and uses it as a
freshness check: a dismissal only counts while the item has not changed since
it was ticked. But `upcomingReleases` and `openTasks` put a **due date** in
that field — a date in the *future*. A future "changed" time is always later
than the moment the editor ticked it, so the item is judged "changed since you
ticked it" and immediately reappears as open.

For `openTasks` this is worse than cosmetic: the task really is closed
server-side, but the row never leaves the Open tab, so the editor is told
nothing happened.

## Current state

Files involved:

- `src/store/dismissals.ts` — pure dismissal logic; contains the freshness rule.
- `src/inbox/types.ts` — the public `InboxItem` contract.
- `src/inbox/sources/upcomingReleases.ts` — puts a future publish date in `timestamp`.
- `src/inbox/sources/openTasks.ts` — puts a future `dueBy` in `timestamp`.
- `src/inbox/sources/unpublishedDrafts.ts` — puts `_updatedAt` in `timestamp` (correct today).
- `src/inbox/InboxSection.tsx` — calls `isDismissed` to split open/done.

The freshness rule, `src/store/dismissals.ts:79-94`:

```ts
export function isDismissed(
  state: DismissalState,
  source: string,
  itemId: string,
  itemTimestamp?: string,
): boolean {
  const dismissedAt = state.dismissed[source]?.[itemId]
  if (typeof dismissedAt !== 'string') return false
  if (!itemTimestamp) return true

  const changed = Date.parse(itemTimestamp)
  const ticked = Date.parse(dismissedAt)
  if (!Number.isFinite(changed) || !Number.isFinite(ticked)) return true

  return changed <= ticked
}
```

The field it reads, `src/inbox/types.ts:28`:

```ts
  /** When this became relevant. Shown as a relative time, and used to order within a group. */
  timestamp?: string
```

Note the doc comment already describes a *display* concern ("shown as a
relative time"), not a change-detection one — the two meanings were conflated.

The offending assignments:

- `src/inbox/sources/upcomingReleases.ts:43,49`:
  ```ts
  const scheduled = release.publishAt || release.metadata.intendedPublishAt
  // ...
  timestamp: scheduled,
  ```
- `src/inbox/sources/openTasks.ts:92`:
  ```ts
  timestamp: row.dueBy || row._updatedAt,
  ```
- `src/inbox/sources/unpublishedDrafts.ts` sets `timestamp: row._updatedAt` — a
  past value, which is why drafts work today.

The call site, `src/inbox/InboxSection.tsx:43`:

```ts
      if (isDismissed(dismissals.state, source.name, item.id, item.timestamp)) doneItems.push(item)
```

Repo conventions to match:

- Pure logic lives in `src/store/dismissals.ts` and is unit-tested in
  `src/store/dismissals.test.ts`. Follow that file's style: `describe` blocks
  per behaviour, plain `expect`, no mocking. Read it before writing tests.
- Public types carry TSDoc with a `@public` tag on the exported symbol and a
  prose sentence per field. Match the surrounding comment voice in
  `src/inbox/types.ts` — explain *why*, not just *what*.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Install   | `npm install`                              | exit 0              |
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0, no output   |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `src/inbox/types.ts`
- `src/store/dismissals.ts`
- `src/store/dismissals.test.ts`
- `src/inbox/InboxSection.tsx`
- `src/inbox/sources/openTasks.ts`
- `src/inbox/sources/upcomingReleases.ts`
- `src/inbox/sources/unpublishedDrafts.ts`
- `README.md` (only the sentence describing dismissal expiry, if present)

**Out of scope** (do NOT touch):
- `src/store/useDismissals.ts` — the persistence hook has a separate, unrelated
  race being fixed in plan 002. Touching it here will cause a merge conflict.
- `src/inbox/InboxRow.tsx`, `src/inbox/SelectionActions.tsx` — display only.
- The `DISMISSAL_TTL_DAYS` pruning logic — unrelated and correct.
- Any change to the stored `DismissalState` shape or `DISMISSAL_VERSION` — the
  stored format must stay readable; this fix is entirely on the read path.

## Git workflow

- Branch: `advisor/001-future-timestamp-dismissals`
- Conventional commits, matching `git log` style, e.g.
  `fix: keep items dismissed when their timestamp is a due date`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a dedicated change-detection field to `InboxItem`

In `src/inbox/types.ts`, add an optional `changedAt` field next to `timestamp`,
and sharpen `timestamp`'s doc comment so the two jobs are visibly separate.
Target shape:

```ts
  /**
   * When this became relevant. Shown as a relative time, and used to order
   * within a group. May be in the future (a due date, a publish date) — this
   * field is for display only and is never used to decide whether an item is
   * still done.
   */
  timestamp?: string
  /**
   * When the underlying thing last changed.
   *
   * Ticking an item records the moment; if the item changes afterwards it
   * returns to the inbox, because the tick said "I have seen this version".
   * Supply it only when the source can report a real modification time —
   * omitting it makes a dismissal permanent until the editor puts the item
   * back, which is the right default for anything whose changes cannot be
   * observed.
   */
  changedAt?: string
```

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Read `changedAt` in the split, not `timestamp`

In `src/inbox/InboxSection.tsx:43`, change the fourth argument from
`item.timestamp` to `item.changedAt`. Do not change `isDismissed` itself in
this step — its contract is already "the item's change time".

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 3: Rename the parameter in `isDismissed` for honesty

In `src/store/dismissals.ts`, rename the `itemTimestamp` parameter to
`itemChangedAt` and update the doc comment so it states that a future value is
never expected and that an absent value means "permanent until restored".
No behaviour change.

**Verify**: `npx vitest run src/store/dismissals.test.ts` → all existing tests
still pass (they pass the argument positionally, so the rename is safe).

### Step 4: Supply `changedAt` from the sources that can

- `src/inbox/sources/openTasks.ts`: keep `timestamp: row.dueBy || row._updatedAt`
  for display, and add `changedAt: row._updatedAt`. The task row already
  selects `_updatedAt` in its GROQ projection — confirm that before using it.
- `src/inbox/sources/unpublishedDrafts.ts`: add `changedAt: row._updatedAt`
  alongside the existing `timestamp: row._updatedAt`.
- `src/inbox/sources/upcomingReleases.ts`: add `changedAt: release._updatedAt`
  if `ReleaseDocument` exposes it; if it does not, **omit `changedAt` entirely**
  so a dismissed release stays dismissed until restored. Do not invent a value.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0, and
`grep -n "changedAt" src/inbox/sources/*.ts` → shows the fields you added.

### Step 5: Add regression tests

See the Test plan below.

**Verify**: `npx vitest run` → all pass, including the new cases.

## Test plan

Add to `src/store/dismissals.test.ts`, in the existing
`describe('a dismissal expires when the item changes', ...)` block — model the
new cases on the ones already there:

1. **The real fix, and the bug it replaces.** Note that `isDismissed` itself is
   unchanged, so passing it a future value still returns `false` — that is the
   *bug shape*, not the fixed behaviour. The fix is that the future value no
   longer reaches it, because the split now passes `changedAt`. So assert both
   halves: an item ticked now, given a realistic past `changedAt` (a release's
   `_updatedAt`), stays dismissed; and the same item given a future due date
   does **not** — documenting exactly why the call site had to change.
   (Corrected 2026-09-09: an earlier draft of this item asked for
   `isDismissed(..., <future>) === true`, which contradicts Step 3's
   "no behaviour change" and is impossible.)
2. **An absent change time keeps the item dismissed** — already covered by the
   existing "stays done forever when the item has no timestamp" test; confirm
   it still passes rather than duplicating it.
3. **A past change time before the tick keeps it dismissed**, and a past change
   time after the tick resurfaces it — both already covered; confirm.

Build timestamps relative to a fixed `now` the way the existing
`describe('pruneDismissals', ...)` block does, rather than using real clock
values, so the test cannot go stale.

**Verification**: `npx vitest run` → all pass, with at least 1 new test.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0 with at least one new test asserting a future
      change time keeps an item dismissed
- [ ] `grep -n "item.timestamp" src/inbox/InboxSection.tsx` returns **no**
      matches (the split now reads `changedAt`)
- [ ] `npm run build` prints `[success]`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `src/store/dismissals.ts:79-94` does not match the excerpt above.
- `ReleaseDocument` has no `_updatedAt` **and** you are tempted to substitute
  another field — omitting `changedAt` is the specified behaviour; do not
  improvise a substitute.
- Making the split read `changedAt` breaks an existing test in
  `wrapStructure.test.ts` or `shouldRedirectToInbox.test.ts` — those files
  should be entirely unaffected, so a failure there means something unexpected
  is coupled.
- You conclude the fix requires changing the stored `DismissalState` shape.

## Maintenance notes

- Any new source must decide deliberately whether it can report a real
  modification time. The safe default is to omit `changedAt`.
- A reviewer should check that no source sets `changedAt` to a future value —
  that reintroduces this bug. A lint rule cannot catch it; the type cannot
  either.
- Deferred: `isDismissed` still returns `true` for an unparseable change time.
  That is deliberate (fail toward "stays done") and unchanged here.
