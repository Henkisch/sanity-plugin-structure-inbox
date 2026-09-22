# Plan 079: Fix the two timestamp assumptions in the Overview card

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/InboxStats.tsx src/inbox/InboxStats.test.tsx src/inbox/types.ts src/store/snoozePresets.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — read-only stats; nothing is written or corrupted.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Two wrong assumptions in the persistent sidebar card — the pane's own "are we
on top of things" summary.

**1. "Oldest open item" can render a negative number.** `oldestOpenAgeDays`
computes `(now - Date.parse(timestamp)) / DAY_MS` with no clamp, but
`src/inbox/types.ts:30-35` documents `timestamp` as "May be in the future (a
due date, a publish date)" — and `src/inbox/sources/todos.ts:118` does exactly
that (`timestamp: todo.dueBy || todo.createdAt`). `Math.floor` on a negative
age floors *away* from zero, so a todo due next week renders
**"Oldest open item: -6 days"**.

Beyond the ugly number, the stat is conceptually wrong for a due-dated row: it
reports the due date's distance, not how long the item has waited.

**2. "Next wakes" compares ISO strings.** `earliest` is chosen by `until < earliest`
on the raw strings. That is only equivalent to chronological order while every
value is a UTC `Z` ISO string of identical precision. `resolveSnoozeUntil`
always produces that — but `InboxSourceResult.suggestSnooze`
(`src/inbox/types.ts:449`) lets a source return any `until: string`, and
`MergedList.tsx:465-472` passes it straight through. An offset-form or
lower-precision string sorts wrong, so the card names the wrong item's date.

## Current state

`src/inbox/InboxStats.tsx:64-76`:

```ts
export function oldestOpenAgeDays(rows: readonly MergedRow[], now: number): number | null {
  let oldest: number | null = null

  for (const row of rows) {
    const time = row.item.timestamp ? Date.parse(row.item.timestamp) : NaN
    if (!Number.isFinite(time)) continue

    const ageDays = (now - time) / DAY_MS
    if (oldest === null || ageDays > oldest) oldest = ageDays
  }

  return oldest
}
```

Note it already skips unparseable timestamps — the same posture should extend
to future ones.

`src/inbox/InboxStats.tsx:216` — `t('stats.days', {count: Math.floor(oldestAgeDays)})`

`src/inbox/InboxStats.tsx:90-96`:

```ts
for (const row of snoozedRows) {
  const until = snoozed[row.sourceName]?.[row.item.id]?.until
  if (!until) continue
  if (earliest === null || until < earliest) earliest = until
}

return earliest
```

**Reachability**: the card appears with very few rows via the `wakesSoon`
branch (`InboxStats.tsx:181`), so this does not need a 12-row backlog.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| This suite | `npx vitest run src/inbox/InboxStats.test.tsx` | all pass |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/inbox/InboxStats.tsx`, `src/inbox/InboxStats.test.tsx`

**Out of scope:**
- `src/inbox/types.ts`'s `timestamp` contract — "may be in the future" is correct and deliberate; the consumer is what is wrong.
- `src/store/snoozePresets.ts` — it produces correct values.
- Narrowing `suggestSnooze`'s `until` type to force UTC. That is a public API change and a bigger decision; robust comparison here is the cheaper correct fix.

## Git workflow

- Branch: `advisor/079-stats-timestamps`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Exclude future timestamps from "oldest open"

A future timestamp is a due date, not an age. Skip it, matching how the
function already skips unparseable values:

```ts
const ageDays = (now - time) / DAY_MS
// A future `timestamp` is a due date, not a wait — `types.ts:30-35`
// documents that it may be in the future, and `todos.ts:118` uses `dueBy`.
// Including it produced "Oldest open item: -6 days", and even ignoring the
// sign it measured the wrong thing.
if (ageDays < 0) continue
```

Prefer skipping over clamping to 0: a clamped row would claim an item has
waited zero days when it has not waited at all.

**Verify**: `npx vitest run src/inbox/InboxStats.test.tsx` → all pass.

### Step 2: Compare wake times as instants

```ts
let earliest: string | null = null
let earliestTime = Infinity

for (const row of snoozedRows) {
  const until = snoozed[row.sourceName]?.[row.item.id]?.until
  if (!until) continue
  // Parsed, not string-compared: `until` is only guaranteed UTC-`Z` when it
  // came from `resolveSnoozeUntil`. A source's own `suggestSnooze` may return
  // any ISO string (`types.ts:449`), and an offset-form value sorts wrong as
  // a string.
  const time = Date.parse(until)
  if (!Number.isFinite(time)) continue
  if (time < earliestTime) {
    earliestTime = time
    earliest = until
  }
}

return earliest
```

Keep returning the original string (callers format it), not the parsed number.

**Verify**: `npx vitest run src/inbox/InboxStats.test.tsx` → all pass.

## Test plan

In `src/inbox/InboxStats.test.tsx`:

1. **The regression**: rows including one with a `timestamp` a week in the
   future → `oldestOpenAgeDays` is `null` (if that is the only row) or the
   oldest *past* row's age. Never negative.
2. `Math.floor` of the result is never negative for any input mix.
3. An unparseable timestamp is still skipped (existing behaviour preserved).
4. **Wake ordering**: two snoozes, one as `2026-01-01T10:00:00Z` and one as
   `2026-01-01T05:00:00-06:00` (which is `11:00Z`, i.e. later, but sorts
   *earlier* as a string). Assert the returned value is the `10:00:00Z` one.
   This test fails before the change.
5. An unparseable `until` is skipped rather than poisoning the comparison.

**Verify**: `npm test` → all pass, 5 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Tests 1 and 4 were confirmed to fail before the change
- [ ] `grep -n "until < earliest" src/inbox/InboxStats.tsx` → no matches
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Skipping future timestamps makes the card disappear in a case where it used
  to show something useful (e.g. every row is due-dated). Report — the honest
  alternative may be a differently-labelled stat rather than a silent empty.
- A source is found that relies on `timestamp` being in the past. Report it;
  the contract says otherwise.

## Maintenance notes

- The rule: **`timestamp` may be in the future** (it is documented that way),
  so any arithmetic on it needs a sign decision. `InboxStats` was the only
  consumer doing age arithmetic — check for new ones in review.
- Any comparison of two `until` values must parse first, because `suggestSnooze`
  is integrator-supplied. A reviewer should look for raw string comparison of
  ISO values anywhere it appears.
