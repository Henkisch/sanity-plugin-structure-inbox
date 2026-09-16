# Plan 031: Add tests for `matchesInboxFilters`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- src/inbox/inboxFilterSentinels.ts`
> If it changed since this plan was written, re-read it before proceeding —
> compare against the excerpt below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

`src/inbox/inboxFilterSentinels.ts`'s own doc comment states its entire
reason to exist: `MergedList.tsx` (filtering what it renders) and
`Inbox.tsx` (the "N things waiting on you" headline count) must never
disagree, and `matchesInboxFilters` is the one function shared between them
that keeps that true. No test file exists for it today
(`src/inbox/inboxFilterSentinels.test.ts` does not exist). A regression in
its empty-set-means-"show everything" semantics, or in the
`ASSIGNEE_UNASSIGNED` sentinel handling, would silently make the headline
count and the visible list disagree — exactly the failure this function
was written to prevent, with nothing to catch it.

## Current state

- `src/inbox/inboxFilterSentinels.ts` — the entire file:
  ```ts
  import {type InboxItem} from './types'

  export const ASSIGNEE_UNASSIGNED = '__unassigned__'

  export function matchesInboxFilters(
    row: {sourceName: string; item: InboxItem},
    assigneeFilter: ReadonlySet<string>,
    typeFilter: ReadonlySet<string>,
  ): boolean {
    if (assigneeFilter.size > 0) {
      const key = row.item.assignee?.id ?? ASSIGNEE_UNASSIGNED
      if (!assigneeFilter.has(key)) return false
    }
    if (typeFilter.size > 0 && !typeFilter.has(row.sourceName)) return false
    return true
  }
  ```
- Repo test convention to match, from `src/inbox/mergeItems.test.ts:1-19`
  (a similarly-shaped pure-function test file in the same directory):
  ```ts
  import {describe, expect, it} from 'vitest'

  import {EMPTY_DISMISSALS, withDismissal} from '../store/dismissals'
  import {mergeRows} from './mergeItems'
  import {type SourceReport} from './SourceFeed'
  import {type InboxItem} from './types'

  function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
    return {id, title: `Item ${id}`, ...extra}
  }
  ```
  Model the new test file's structure after this one: a small local `item()`
  helper building minimal `InboxItem`s, then `describe`/`it` blocks with
  direct `expect(...).toBe(...)` assertions. No mocking needed —
  `matchesInboxFilters` is a pure function with no dependencies beyond the
  `InboxItem` type.
- House style (no comments explaining *what* code does, only *why*, when
  non-obvious) — a test file this small and this directly named needs
  little to no comments at all; the existing `mergeItems.test.ts` has none
  in its own test bodies, only in its fixture helpers where warranted.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test -- inboxFilterSentinels` | all new tests pass |
| Full suite | `npm test` | all pass, 367 + new tests |

## Scope

**In scope**:
- `src/inbox/inboxFilterSentinels.test.ts` (new file)

**Out of scope**:
- `src/inbox/inboxFilterSentinels.ts` itself — this plan adds tests for the
  existing behavior, it does not change the function.
- `MergedList.tsx`/`Inbox.tsx` — their own call sites are unaffected.

## Git workflow

- Commits land directly on `main`. Message style: `test: cover
  matchesInboxFilters's own filter semantics`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Create the test file

Create `src/inbox/inboxFilterSentinels.test.ts` with at minimum these
cases, each a separate `it`:

- **Empty filters, item has no assignee** → `matchesInboxFilters` returns
  `true` (empty set means "show everything," per the source file's own doc
  comment).
- **`assigneeFilter` has one real id, item's `assignee.id` matches it** →
  returns `true`.
- **`assigneeFilter` has one real id, item's `assignee.id` is a different
  id** → returns `false`.
- **`assigneeFilter` contains `ASSIGNEE_UNASSIGNED`, item has no
  `assignee` at all** → returns `true` (the sentinel matches an absent
  assignee).
- **`assigneeFilter` contains `ASSIGNEE_UNASSIGNED`, item *does* have a
  real assignee** → returns `false`.
- **`typeFilter` has one source name, row's `sourceName` matches** →
  returns `true`.
- **`typeFilter` has one source name, row's `sourceName` doesn't match** →
  returns `false`.
- **Both filters set, row satisfies assignee filter but fails type
  filter** → returns `false` (both must pass — confirm this is genuinely
  AND, not OR, by reading the source's own two sequential early-returns
  again if unsure).
- **Both filters set, row satisfies both** → returns `true`.

Build minimal row fixtures directly inline (`{sourceName: 'drafts', item:
{id: 'x', title: 'X', assignee: {id: 'ada', label: 'Ada'}}}`) — no shared
helper needed for a file this small, though you may add one if it reduces
repetition meaningfully; follow your own judgment on that, it's not
load-bearing.

**Verify**: `npm test -- inboxFilterSentinels` → all new tests pass.

## Test plan

Covered fully in Step 1's own list above — this plan's entire deliverable
*is* the test plan. No additional coverage needed beyond those 9 cases
unless you find a genuinely distinct branch in the source you believe is
untested by them (there are only two `if` statements in the whole
function, so this is unlikely).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; `src/inbox/inboxFilterSentinels.test.ts` exists
      with at least the 9 cases above, all passing
- [ ] No files outside `src/inbox/inboxFilterSentinels.test.ts` are created
      or modified (`git status`)
- [ ] `plans/README.md` status row for 031 updated

## STOP conditions

- The source file's actual behavior for any case above doesn't match what
  this plan predicts (e.g. if the two filters turn out to be OR'd rather
  than AND'd) — write the test asserting the *actual* observed behavior,
  then STOP and report the discrepancy against this plan's own
  documentation of intended behavior rather than silently treating your
  test as correct.

## Maintenance notes

If `matchesInboxFilters` ever gains a third filter dimension, add cases
here in the same style rather than starting a second test file for the
same function.
