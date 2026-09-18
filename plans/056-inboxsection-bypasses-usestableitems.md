# Plan 056: Route aside sources through `useStableItems` too

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 478e05a..HEAD -- src/inbox/InboxSection.tsx src/inbox/useStableItems.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `478e05a`, 2026-09-18

## Why this matters

Plan 054 fixed an infinite render loop by routing a source's `items` through
`useStableItems` in `SourceFeed`. `InboxSection` — the component that renders
`placement: 'aside'` sources — calls `source.useItems()` directly and never got
the same treatment. Aside sources are therefore still unprotected against the
exact bug that took down a customer's Structure tool.

It does not loop **today**, and only by luck: `InboxSection`'s report effect
depends on `open.length`, a number. An unstable `items` identity is invisible to
it. That is one refactor away from being a crash — change that effect to depend
on `open` and the loop is back, in a component nobody would think to check.

It also costs real work per render right now: every render rebuilds the split
arrays and re-renders the card, for aside sources, forever.

## Current state

`src/inbox/InboxSection.tsx:41-44` — the whole of the relevant code:

```tsx
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, snoozes, view, compact = false, onCount} = props

  const {items, loading, error, create, assign, update, action} = source.useItems()
```

`src/inbox/InboxSection.tsx:95-96` — why it is currently benign:

```tsx
    onCount(source.name, open.length)
  }, [onCount, source.name, open.length])
```

Contrast the already-fixed path, `src/inbox/SourceFeed.tsx:60-67`:

```tsx
  const result = source.useItems()

  // Not `result.items` directly: a source is free to build its items fresh on
  // every render (the shape the README documents, and the shape any hand-written
  // source naturally takes), and a new array identity every render would re-fire
  // the report effect below forever — see `useStableItems`' own doc comment for
  // the crash this prevents.
  const items = useStableItems(result.items)
```

`useStableItems` is exported from `src/inbox/useStableItems.ts` and is
`@internal`. It takes `InboxItem[]` and returns the previous array while the
content is unchanged.

## Commands you will need

| Purpose    | Command                                            | Expected on success |
|------------|----------------------------------------------------|---------------------|
| Typecheck  | `npm run typecheck`                                | exit 0, no output   |
| Lint       | `npm run lint`                                      | exit 0, no output   |
| Focused    | `npx vitest run src/inbox/InboxSection.test.tsx`    | all pass            |
| Full tests | `npm test`                                          | all pass            |

## Scope

**In scope:**
- `src/inbox/InboxSection.tsx`
- `src/inbox/InboxSection.test.tsx`

**Out of scope:**
- `src/inbox/SourceFeed.tsx` — already correct.
- `src/inbox/useStableItems.ts` — no change needed; this plan only adds a caller.
- Changing `InboxSection`'s report effect to depend on `open` instead of
  `open.length`. It is fine as is, and widening it is a separate decision.

## Git workflow

- Branch: `advisor/056-inboxsection-stable-items`
- Conventional Commits. This is a `fix:` — it changes shipped behaviour and
  should cut a patch release.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Route `items` through the hook

In `src/inbox/InboxSection.tsx`, mirror `SourceFeed`'s shape exactly: keep the
result in a variable, pass `result.items` through `useStableItems`, and
destructure the rest from `result`.

Add a short comment pointing at `useStableItems`' own doc comment, matching the
repo's "explain why, not what" convention. Say plainly that this is the same
protection `SourceFeed` has, applied to the aside column.

Add the import: `import {useStableItems} from './useStableItems'`.

**Verify**: `npm run typecheck` → exit 0. `npm run lint` → exit 0.

### Step 2: Pin it with a test

Add a case to `src/inbox/InboxSection.test.tsx` using a source that builds its
`items` fresh on every call, asserting `onCount` fires exactly once for a stable
content set.

Note in a comment that the existing fixtures in this file already build items
fresh per render (`InboxSection.test.tsx:76` onward) and never caught this,
because the effect keys on `open.length` — a primitive.

**Verify**: `npx vitest run src/inbox/InboxSection.test.tsx` → all pass.

### Step 3: Confirm the test is load-bearing

Temporarily revert step 1 (`const items = result.items`), re-run the focused
test, and confirm the **new** test fails. Then restore.

If it passes without the fix, the test is not testing anything — rewrite it to
assert on array identity across a forced re-render, or report under STOP
conditions.

**Verify**: test fails without the fix, passes with it. Restore the fix.

### Step 4: Full suite

**Verify**: `npm test` → all pass. `npm run build` → `[success]`.

## Test plan

- New test in `src/inbox/InboxSection.test.tsx`: a churning aside source reports
  its count once, not per render.
- Structural pattern: `src/inbox/SourceFeed.test.tsx`'s
  "reports once for a source that rebuilds its items on every render", which does
  the same thing one layer up.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, including the new test
- [ ] `grep -n "useStableItems" src/inbox/InboxSection.tsx` returns a match
- [ ] Step 3 confirmed the new test fails without the fix
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The new test passes with the fix reverted (step 3). Report instead of shipping
  a decorative test.
- `useStableItems` cannot be called here because of hook-order constraints
  (it must be unconditional, before any early return). Report the conflict.
- Applying the change breaks an existing `InboxSection` test in a way that is not
  obviously a stale assertion. Report which.

## Maintenance notes

- After this lands, **both** consumers of `source.useItems()` are protected.
  `grep -rn "source.useItems()" src/` should return exactly two call sites, both
  routing through `useStableItems`. That grep is the review check for any future
  third consumer.
- Plan 055 adds a parametrised test asserting built-in sources are stable at the
  source. That is complementary: 055 stops the plugin's own sources from churning,
  this plan stops an integrator's churn from costing anything.
