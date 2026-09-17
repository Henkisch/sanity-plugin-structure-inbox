# Plan 050: The "Overdue" sidebar stat counts rows that aren't actually overdue

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/inbox/types.ts src/inbox/InboxStats.tsx src/inbox/InboxStats.test.tsx src/inbox/sources/openTasks.ts src/inbox/sources/todos.ts src/inbox/sources/documentValidation.ts src/inbox/sources/linkCheckerFindings.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (UI consistency / correctness)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

The persistent "Overview" sidebar card shows an "Overdue" stat
(`src/inbox/InboxStats.tsx`'s `countOverdue`), computed by counting every
open row whose `item.tone === 'critical'`. But `tone` is a generic
severity-coloring field — its only doc comment in `src/inbox/types.ts` is
"Colours the row. Use sparingly — everything urgent means nothing is." It
is not specifically an "overdue" signal. Two sources genuinely use it that
way: `openTasks.ts` and `todos.ts` both set `tone: 'critical'` only when
`isOverdue(dueBy)` is true. But two other sources use the same tone value
for something else entirely: `documentValidation.ts` sets `tone:
'critical'` unconditionally for every draft with a failing `error`-level
validation marker (nothing to do with a due date), and
`linkCheckerFindings.ts` does the same for a confirmed broken reference or
link. Both default to `placement: 'main'`, so their rows feed straight
into the same `openRows` the Overview card counts.

The practical effect: an editor sees "Overdue: 4" on the persistent
sidebar and reasonably reads that as "4 things past their due date" — but
the count may be entirely made up of broken links or failed-validation
drafts that have no due date concept at all. The stat's label is
mislabeled for roughly half the sources that can produce a `critical`
tone. The fix: stop deriving "overdue" from the generic severity `tone`
field; add an explicit, source-declared fact only the two due-date-based
sources set, and have the stat read that instead.

## Current state

- `src/inbox/types.ts` — `InboxItem.tone`'s only doc comment (near line
  58): `/** Colours the row. Use sparingly — everything urgent means
  nothing is. */` followed by
  `tone?: 'default' | 'primary' | 'positive' | 'caution' | 'critical'`.
  This is the complete specification of what `tone` means — it says
  nothing about due dates or overdue-ness. That semantic was invented
  later, only in `InboxStats.tsx`'s own `countOverdue` doc comment (see
  below), and only holds for 2 of the 4 sources that actually set
  `'critical'`.

- `src/inbox/InboxStats.tsx` — current code (near line 104):
  ```tsx
  /**
   * Open rows a source has already, deterministically, called critical —
   * never a due-date guess: `InboxItem.timestamp`'s own doc comment says it
   * "may be in the future... this field is for display only," so a past
   * timestamp alone is not evidence of overdue (most open rows have one, that
   * is what "waiting since" means). `tone === 'critical'` is the one signal a
   * source already sets deliberately for exactly this ("use sparingly," per
   * that field's own doc comment), so it's the only thing this counts.
   */
  export function countOverdue(rows: readonly MergedRow[]): number {
    return rows.filter((row) => row.item.tone === 'critical').length
  }
  ```
  This doc comment's own premise is the bug: `tone === 'critical'` is
  *not* "the one signal a source already sets deliberately for exactly
  this [overdue]" — it's a signal for "this row is severely bad," which
  two sources happen to tie to overdue-ness and two others don't.

- `src/inbox/sources/todos.ts:18` (helper) and `:119` (usage):
  ```ts
  function isOverdue(dueBy?: string): boolean {
    // ... real due-date comparison ...
  }
  // ...
  tone: isOverdue(todo.dueBy) ? 'critical' : 'default',
  ```

- `src/inbox/sources/openTasks.ts:130` (helper, an independent, separately
  duplicated copy of the same logic — not shared with `todos.ts`) and
  `:261` (usage):
  ```ts
  function isOverdue(dueBy?: string): boolean {
    // ... real due-date comparison ...
  }
  // ...
  tone: isOverdue(row.dueBy) ? 'critical' : 'default',
  ```

- `src/inbox/sources/documentValidation.ts:353` — sets `tone: 'critical'`
  unconditionally for any `error`-level validation marker on a draft — no
  due-date concept at all.

- `src/inbox/sources/linkCheckerFindings.ts:180` and `:193` — sets `tone:
  'critical'` for a confirmed broken reference or broken link — also no
  due-date concept.

- `src/inbox/InboxStats.test.tsx` — the existing test for this function
  (near line 131):
  ```ts
  describe('countOverdue', () => {
    it('counts only rows whose source already set a critical tone', () => {
      const rows = [
        row('tasks', {id: '1', tone: 'critical'}),
        row('tasks', {id: '2', tone: 'caution'}),
        row('tasks', {id: '3', tone: 'critical'}),
      ]
      expect(countOverdue(rows)).toBe(2)
    })
  })
  ```
  This test's own name/premise will need to change along with the
  implementation (see Test plan).

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run src/inbox/InboxStats.test.tsx` then `npx vitest run` (full) | all pass |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope**:
- `src/inbox/types.ts` — add one new optional field to `InboxItem`
- `src/inbox/sources/openTasks.ts` — set the new field
- `src/inbox/sources/todos.ts` — set the new field
- `src/inbox/InboxStats.tsx` — `countOverdue` reads the new field instead
  of `tone`
- `src/inbox/InboxStats.test.tsx` — update the existing test

**Out of scope**:
- `src/inbox/sources/documentValidation.ts` and
  `src/inbox/sources/linkCheckerFindings.ts` — do NOT change their `tone`
  values or add the new field to them. They correctly stay `tone:
  'critical'` (their rows should still render red — that part is
  correct), they just correctly do NOT set the new "overdue" field, so
  they correctly stop being counted in the Overdue stat.
- Any other consumer of `item.tone` (e.g. `InboxRow.tsx`'s own row-color
  derivation, or `openTaskDetail`'s reuse of `item.tone === 'critical'` at
  `src/inbox/sources/openTasks.ts` around line 382 for its own AI-summary
  tone) — leave every other `tone` read exactly as it is. This plan only
  changes what `countOverdue` reads, not what `tone` means everywhere
  else.
- Do NOT rename or restructure the existing `tone` field itself.
- Do NOT deduplicate the two separate `isOverdue` helper functions in
  `openTasks.ts`/`todos.ts` into one shared helper — that is a real, minor
  tech-debt observation but a separate, unrelated change; each file keeps
  its own private helper, just reused one more time (for the new field) in
  the same file it's already defined in.

## Git workflow

- Branch: `advisor/050-overdue-stat-tone-overload`
- Two commits are fine (one for the type + source changes, one for the
  `InboxStats.tsx`/test change), or one combined commit — match this
  repo's own convention of one commit per plan where the change is this
  size. Message: `fix: stop deriving the Overdue stat from the generic severity tone`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `overdue?: boolean` to `InboxItem`

In `src/inbox/types.ts`, add a new optional field next to `tone` (after
it, in the same interface), with a doc comment explaining the distinction
from `tone`:

```ts
/**
 * True only when the source itself knows this item has a real due date
 * that has already passed. Distinct from `tone`: `tone` colors the row for
 * *any* severity reason a source wants (a broken link, a failed
 * validation, an overdue task all set `tone: 'critical'`), while this
 * field is specifically the due-date fact `InboxStats`'s own "Overdue"
 * count needs — only set it when there's a real due date being compared
 * against, never as a stand-in for "this is bad."
 */
overdue?: boolean
```

**Verify**: `npm run typecheck` → exit 0 (adding an optional field cannot
break existing callers).

### Step 2: Set the new field in `openTasks.ts` and `todos.ts`

In `src/inbox/sources/todos.ts`, on the same object that sets `tone:
isOverdue(todo.dueBy) ? 'critical' : 'default'` (line 119), add a sibling
field: `overdue: isOverdue(todo.dueBy),` — reuse the exact same
already-computed boolean, no new logic.

In `src/inbox/sources/openTasks.ts`, do the same next to its own `tone:
isOverdue(row.dueBy) ? 'critical' : 'default'` (line 261): add
`overdue: isOverdue(row.dueBy),`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Update `countOverdue` to read the new field

In `src/inbox/InboxStats.tsx`, change:
```ts
export function countOverdue(rows: readonly MergedRow[]): number {
  return rows.filter((row) => row.item.tone === 'critical').length
}
```
to:
```ts
export function countOverdue(rows: readonly MergedRow[]): number {
  return rows.filter((row) => row.item.overdue === true).length
}
```
Update the doc comment above it to describe the real, corrected fact:
remove the claim that `tone === 'critical'` is "the one signal a source
already sets deliberately for exactly this" (it isn't — see "Why this
matters" above) and replace with something like: "Counts only rows whose
source explicitly set `overdue: true` — a due-date fact, not the generic
`tone` severity color, which several non-overdue sources
(`documentValidation`, `linkCheckerFindings`) also set to `'critical'` for
unrelated reasons."

**Verify**: `npm run typecheck` → exit 0.

## Test plan

- Update the existing test in `src/inbox/InboxStats.test.tsx`
  (`describe('countOverdue', ...)`): change its rows to use `overdue:
  true`/`overdue: false` (or omit the field) instead of `tone: 'critical'`
  / `tone: 'caution'`, and rename the test description to reflect the new
  behavior, e.g. `'counts only rows explicitly marked overdue'`.
- Add one new test to the same `describe` block proving the actual bug
  this plan fixes: a row with `tone: 'critical'` but `overdue` unset/false
  (simulating `documentValidation`/`linkCheckerFindings`) must NOT be
  counted. E.g.:
  ```ts
  it('does not count a merely-critical-toned row that is not overdue', () => {
    const rows = [
      row('tasks', {id: '1', tone: 'critical', overdue: true}),
      row('assetIssues', {id: '2', tone: 'critical'}), // no `overdue` — e.g. a broken link
    ]
    expect(countOverdue(rows)).toBe(1)
  })
  ```
  (Check this test file's own `row`/`item` helper functions near the top
  for the exact signature to construct a `MergedRow` — follow the existing
  pattern other tests in this file already use, don't invent a new one.)
- If `src/inbox/sources/openTasks.test.ts` has an existing harness that
  already constructs raw task rows and could cheaply assert the new
  `overdue` field on the resulting `InboxItem` (check its existing tests
  first), add one assertion there too. If no such harness exists and
  building one is non-trivial, it is acceptable to skip a dedicated
  `openTasks.ts`/`todos.ts`-level test for this specific field — the
  `InboxStats.test.tsx` test above is the one that actually proves the bug
  is fixed from the consumer's perspective, and the two source-file
  changes are single-line, low-risk additions reusing an
  already-tested-elsewhere boolean. Note in your final report whichever
  path you took.
- Verification: `npx vitest run src/inbox/InboxStats.test.tsx` → all pass,
  including the new test. Then `npx vitest run` (full suite) → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0; `InboxStats.test.tsx`'s `countOverdue`
      tests updated and a new test proving a merely-critical, non-overdue
      row is excluded exists and passes
- [ ] `npm run build` exits 0
- [ ] `grep -n "item.tone === 'critical'" src/inbox/InboxStats.tsx` returns
      no matches (confirms `countOverdue` no longer reads `tone`)
- [ ] `git status` shows only `src/inbox/types.ts`,
      `src/inbox/sources/openTasks.ts`, `src/inbox/sources/todos.ts`,
      `src/inbox/InboxStats.tsx`, and `src/inbox/InboxStats.test.tsx`
      changed
- [ ] `plans/README.md` status row for plan 050 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the cited lines/values in "Current state" don't match the live
  code (drift since this plan was written) — especially the exact `tone`-
  setting lines in the 4 named sources, since the fix depends on knowing
  precisely which 2 are due-date-based and which 2 aren't.
- `MergedRow`'s test-helper `row(...)` function in
  `InboxStats.test.tsx` doesn't accept an `overdue` field the way assumed
  (check its actual signature — it likely spreads `Partial<InboxItem>`
  through, in which case this just works, but confirm before assuming).
- You find a fifth or sixth source (beyond the 4 named here) that also
  sets `tone: 'critical'` — re-check whether it's due-date-based (needs
  the new field) or not (stays as-is) before deciding, and note what you
  found in your final report either way.

## Maintenance notes

- Any future source that wants its rows counted in the "Overdue" stat
  must now set `overdue: true` explicitly — simply setting `tone:
  'critical'` is no longer sufficient (and was never supposed to be). This
  is the whole point of the fix; a reviewer should specifically check that
  no future PR re-introduces a `tone`-based read for this stat.
- The two independent, duplicated `isOverdue` helper functions in
  `openTasks.ts` and `todos.ts` remain unshared after this plan (out of
  scope here, see above) — a future refactor could extract one shared
  helper (e.g. into a small `src/inbox/sources/dueDate.ts`) if a third
  due-date-based source is ever added.
