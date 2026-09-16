# Plan 037: `RelativeTime` allocates a fresh `Date` every render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/inbox/RelativeTime.tsx`
> If it changed since this plan was written, re-read it before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: performance
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`RelativeTime` renders once per row that has a timestamp — potentially
dozens of times per render of the main list. Every one of those renders
allocates a brand-new `Date` object via `new Date(timestamp)`, even though
`timestamp` (a string prop) hasn't changed. `useRelativeTime` (Sanity's own
hook) very likely keys its own auto-refresh interval on the identity of the
`Date` object it's handed, not just its value — a fresh object every render
means that internal bookkeeping is redone every time, for no reason, on
every row, on every unrelated re-render of the list. A one-line `useMemo`
removes the allocation and keeps the same `Date` reference across renders
where `timestamp` hasn't changed.

## Current state

- `src/inbox/RelativeTime.tsx` — the entire file:
  ```tsx
  import {useRelativeTime} from 'sanity'

  /**
   * Renders a timestamp the way the rest of the Studio does — "2 hours ago",
   * localized, and refreshing on its own — rather than a raw date string.
   */
  export function RelativeTime({timestamp}: {timestamp: string}) {
    const formatted = useRelativeTime(new Date(timestamp), {minimal: true, useTemporalPhrase: true})
    return <>{formatted}</>
  }
  ```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/RelativeTime.tsx`

**Out of scope**:
- Any caller of `RelativeTime` — the prop contract (`timestamp: string`) is
  unchanged; this is purely an internal fix.

## Git workflow

- Commits land directly on `main`. Message style: `fix: stop allocating a
  fresh Date every render in RelativeTime`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Memoize the `Date`

```tsx
import {useMemo} from 'react'
import {useRelativeTime} from 'sanity'

/**
 * Renders a timestamp the way the rest of the Studio does — "2 hours ago",
 * localized, and refreshing on its own — rather than a raw date string.
 */
export function RelativeTime({timestamp}: {timestamp: string}) {
  const date = useMemo(() => new Date(timestamp), [timestamp])
  const formatted = useRelativeTime(date, {minimal: true, useTemporalPhrase: true})
  return <>{formatted}</>
}
```

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

No new test needed — this is a pure internal optimization with no
observable output change (`useRelativeTime`'s own rendered text is
unaffected by whether the `Date` object it receives is freshly allocated
or memoized, only by the moment in time it represents). Existing tests
that render rows with timestamps (`MergedList.test.tsx`,
`InboxRow.test.tsx`) are the regression guard: if `RelativeTime` still
renders the same text, nothing broke.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, no new failures
- [ ] `npm run build` exits 0
- [ ] `RelativeTime.tsx` wraps its `Date` construction in `useMemo` keyed on
      `timestamp`
- [ ] No files outside `src/inbox/RelativeTime.tsx` are modified (`git
      status`)
- [ ] `plans/README.md` status row for 037 updated

## STOP conditions

None expected — this is a minimal, self-contained, one-file change.

## Maintenance notes

None — this file is now as small as it should stay.
