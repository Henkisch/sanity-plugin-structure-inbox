# Plan 055: Fail the build when a built-in source's `useItems()` churns identity

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 478e05a..HEAD -- src/inbox/useStableItems.ts src/inbox/sources/capability.test.ts src/test/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `478e05a`, 2026-09-18

## Why this matters

A source whose `useItems()` returns a new `items` array identity on every render
used to take the entire Structure tool down with React's "Maximum update depth
exceeded". That has now happened **three times** in this repo's own code:
`assign`'s identity (fixed with a fingerprint dependency list in
`SourceFeed.tsx`), `items` itself (fixed by `useStableItems`, plan 054), and a
per-render `new Error(...)` in `needsAttention.ts` / `upcomingReleases.ts`
(fixed by hoisting to a module constant, also plan 054).

469 tests passed through all three. No lint rule can catch this class — see
"Why not a lint rule" below. A test can, and the two pieces it needs already
exist in the repo. This plan builds it.

`useStableItems` protects *integrators'* sources at runtime. `AGENTS.md` states
the built-ins "should not be relying on it". Nothing enforces that today; this
plan is that enforcement.

## Current state

- `src/inbox/useStableItems.ts:52` already exports the comparison half:
  ```ts
  export function sameItems(a: InboxItem[], b: InboxItem[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    return a.every((item, index) => sameValue(item, b[index]))
  }
  ```
  It is `@internal`, recurses into `intent`, and compares `icon` by `===`. It
  has 9 passing tests in `src/inbox/useStableItems.test.ts`.

- `src/inbox/sources/capability.test.ts:60-88` already iterates the public
  barrel under a single `vi.mock('sanity', ...)` that stubs the Studio hooks,
  and *constructs* every source:
  ```ts
  const barrel = await import('../../index')
  expect(() => barrel.openTasks()).not.toThrow()
  expect(() => barrel.upcomingReleases()).not.toThrow()
  expect(() => barrel.unpublishedDrafts()).not.toThrow()
  ```
  It stops one step short of calling `useItems()`. That is the seat this plan
  fills.

- `src/inbox/sources/unpublishedDrafts.test.ts:48` establishes the per-source
  harness this repo uses: `renderHook` plus a hand-built `SanityClient` stub
  with `observable.fetch`, `listen` and `request`. Match it.

- Repo conventions: tests are colocated (`src/**/X.test.ts`), use `vitest`
  (`describe`/`it`/`expect` imported explicitly — `globals: false` in
  `vitest.config.ts`), and carry a comment explaining *why* a non-obvious
  assertion exists. Follow that voice; see `src/inbox/SourceFeed.test.tsx:16-23`
  for an exemplar.

### Why not a lint rule (do not attempt this instead)

`react/exhaustive-deps` and `react/rules-of-hooks` are already `error` via
`@sanity/plugin-kit/oxlint`. Neither catches this: `SourceFeed.tsx`'s dependency
list was **exhaustive and correct** — the bug was a correctly-listed dependency
whose identity churned. The React Compiler rules that come closest
(`react/hooks`, `react/memo-dependencies`, `react/exhaustive-effect-dependencies`,
`react/no-deriving-state-in-effects`) are disabled by plugin-kit; forcing them on
produces 10 errors, several architecturally unfixable (`source.useItems()` is a
dynamically-selected hook — that *is* the plugin's public extension contract).
TypeScript cannot express "stable across renders" either. Do not spend effort here.

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                            | exit 0, no output   |
| Lint      | `npm run lint`                                  | exit 0, no output   |
| One test  | `npx vitest run src/inbox/sources/capability.test.ts` | all pass       |
| Full tests| `npm test`                                      | all pass            |

## Scope

**In scope:**
- `src/test/expectStableSource.ts` (create)
- `src/test/expectStableSource.test.ts` (create)
- `src/inbox/sources/capability.test.ts` (extend)

**Out of scope** (do NOT touch, even though they look related):
- `src/inbox/useStableItems.ts` — the runtime absorption is correct and shipped;
  this plan tests the sources, it does not change the safety net.
- `src/inbox/SourceFeed.tsx` — see STOP conditions; routing the helper through
  `SourceFeed` defeats the entire point of this plan.
- Any source file under `src/inbox/sources/`. If the new test fails on a source,
  that is a **finding to report**, not a fix to make here.

## Git workflow

- Branch: `advisor/055-source-stability-guardrail`
- Conventional Commits (`.releaserc.json` reads them to decide releases). A test-only
  change is `test:` — it must NOT trigger a release. Example from `git log`:
  `fix: stop an unmemoized source's items from looping the pane`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the helper

Create `src/test/expectStableSource.ts` exporting:

```ts
export function expectStableSource(source: InboxSource, renderOptions?: {rerenders?: number}): void
```

It must:
1. `renderHook(() => source.useItems())` from `@testing-library/react`.
2. Capture `result.current`.
3. `rerender()` with no state change (default 2 rerenders).
4. Assert, for each rerender, that **identity is preserved** on every field that
   reaches `SourceFeed`'s report-effect dependency list:
   - `items` — `expect(next.items).toBe(prev.items)`, and additionally
     `expect(sameItems(prev.items, next.items)).toBe(true)` so a failure message
     distinguishes "new array, same content" from "content actually changed".
   - `error` — `expect(next.error).toBe(prev.error)`. **This is the field that
     caught the third regression**; do not omit it.
   - `action`, `assign`, `transfer` — `toBe` when both sides are defined.
5. Produce a failure message naming `source.name` and the offending field.

Import `sameItems` from `../inbox/useStableItems`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Prove the helper actually fails

Create `src/test/expectStableSource.test.ts` with two cases:
- A deliberately churning source (`useItems: () => ({items: [{id: 'a', title: 'A'}]})`)
  → `expect(() => expectStableSource(churning)).toThrow()`.
- A deliberately churning **error** source (`useItems: () => ({items: STABLE_EMPTY, error: new Error('x')})`)
  → also throws. This is the regression shape from plan 054.
- A stable source (hoisted result object) → does not throw.

A guardrail that has never been seen to fail is not a guardrail.

**Verify**: `npx vitest run src/test/expectStableSource.test.ts` → 3 tests pass.

### Step 3: Wire it over the whole barrel

In `src/inbox/sources/capability.test.ts`, add a new `describe` block that
enumerates every source factory exported from `../../index` and runs
`expectStableSource` on each via `it.each`.

Run it under the file's **existing** `vi.mock('sanity', ...)` — the degenerate
context where the beta hooks are absent. That is deliberate and is the highest-value
variant: it is the branch every non-Enterprise Studio takes on every render
forever, and it is exactly where the third regression lived.

List the sources explicitly rather than reflecting over the barrel, so a new
source added without a row here is visible in review.

**Verify**: `npx vitest run src/inbox/sources/capability.test.ts` → all pass,
including one new case per source.

### Step 4: Full suite

**Verify**: `npm test` → all pass (469 existing + the new ones), `npm run lint`
→ exit 0, `npm run typecheck` → exit 0.

## Test plan

Covered by steps 2 and 3. Model the file structure on
`src/inbox/sources/capability.test.ts` (mocking shape) and
`src/inbox/useStableItems.test.ts` (assertion style).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `src/test/expectStableSource.ts` exists and is imported by
      `src/inbox/sources/capability.test.ts`
- [ ] `src/test/expectStableSource.test.ts` proves the helper throws on a
      churning `items` **and** on a churning `error`
- [ ] `grep -n "SourceFeed" src/test/expectStableSource.ts` returns no matches
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- **A built-in source fails the new assertion.** That is a real bug of the same
  class as plan 054. Report which source and which field; do not fix the source
  in this plan.
- You find yourself wanting to render through `SourceFeed` to make a source pass.
  `useStableItems` would launder the instability and the test would go green while
  the thing it guards stays broken. This is the one way to get this plan wrong.
- A source cannot be rendered at all under the degenerate mock (throws rather than
  returning an error result). Report it; it may need `useSafely`.
- `renderHook` requires context this suite does not build (a real `SanityClient`,
  an addon dataset). Report which source and stop — do not build nine harnesses.

## Maintenance notes

- Every new built-in source needs a row in the `it.each` list. That is deliberate
  friction.
- If `InboxSourceResult` gains a field that reaches `SourceFeed`'s dependency
  list, add it to the helper's identity assertions — the same allowlist discipline
  `SourceFeed.tsx:93-101` already documents.
- Deferred on purpose: a happy-path variant with a stubbed client per source
  (roughly `unpublishedDrafts.test.ts` × 9). Ship the cheap degenerate variant
  first; it lands on the branch that actually regressed.
- This does **not** cover integrators' hand-written sources. Those are covered at
  runtime by `useStableItems`, which is a different and deliberate promise.
