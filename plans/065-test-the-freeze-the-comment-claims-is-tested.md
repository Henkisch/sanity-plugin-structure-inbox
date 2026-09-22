# Plan 065: Actually test the guard that stops the Structure tool dying

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/useStableItems.ts src/inbox/useStableItems.test.ts src/inbox/InboxSection.tsx src/warnOnce.ts test-studio/unmemoizedCanary.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — new tests plus one corrected comment. No behaviour change.
- **Depends on**: none
- **Category**: tests + docs (a false claim in a comment)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`useStableItems` exists because an unmemoized `items` array from a source took
down a real customer's Structure tool with React's "Maximum update depth
exceeded". Its last line of defence is a **freeze**: after
`MAX_CONSECUTIVE_ADOPTIONS` renders where the content never compares equal, it
warns once and returns the previous array instead of adopting a new one,
converting an infinite render loop into a stale list plus a console warning.

That branch is reached by no test. And the code says otherwise —
`useStableItems.ts:115` ends its reasoning with **"Confirmed by test, not
assumed."**

The test that appears to be that confirmation proves the opposite. It is named
`keeps updating, because two inline icons compare equal by name`, and its own
comment says "this is the *legitimate* case and must keep updating". It
exercises the settling path, not the freeze.

The reason is a change that happened after the comment was written: `sameValue`
now compares two functions **by name** (`useStableItems.ts:39-41`), specifically
so a per-render inline `icon` no longer freezes a source. That fix was correct —
but it also removed the only value the test used to trigger the freeze. The
values that can still never compare equal are `Date`, `Map`, `Set` and class
instances, which fall through to `return false`. No test uses any of them.

So the guard on the repo's worst known failure mode is untested, and the
codebase asserts that it is tested. `AGENTS.md` already records that four
things this codebase claimed about itself turned out to be false; this is
another, on the highest-stakes path.

There is a second, smaller gap: the guard only covers `main` sources.
`SourceFeed.tsx` is `useStableItems`' only caller, and `InboxSection.tsx:44`
(the `aside` placement) calls `source.useItems()` directly with no
stabilisation.

## Current state

**The claim** — `src/inbox/useStableItems.ts:108-115`:

```ts
// neither a primitive, a plain object nor an array (a function, a `Date`, a
// `Map`, a class instance) can only be compared by `===`, so an item
// carrying a freshly-allocated one of those on every render compares
// unequal *forever*. `icon?: ComponentType` is exactly that shape and is
// documented public API. Without a bound, this hook's own `setStable` below
// then runs on every render, which is a render-phase update loop — upstream
// of `sameReport` and of the error boundary around `SourceFeed`, so neither
// can contain it. Confirmed by test, not assumed.
```

**The branch nothing reaches** — `src/inbox/useStableItems.ts:123-132`:

```ts
if (stable !== items && !sameItems(stable, items)) {
  if (adoptions.current >= MAX_CONSECUTIVE_ADOPTIONS) {
    warnOnce(
      `${sourceName} returns items that never compare equal — most likely a value on each item ` +
        `(an \`icon\`, a \`Date\`, a \`Map\`) is allocated fresh on every render. Its rows are now ` +
        `frozen at the last version rather than looping. Memoize the items, or hoist that value.`,
    )
    return stable
  }
  adoptions.current += 1
```

**Why functions no longer trigger it** — `src/inbox/useStableItems.ts:39-41`:

```ts
if (typeof a === 'function' && typeof b === 'function') {
  return a.name === b.name
}
```

**The fallthrough that still does** — `src/inbox/useStableItems.ts:51`:
`return false` (reached by `Date`, `Map`, `Set`, class instances).

**The test that does not test the freeze** —
`src/inbox/useStableItems.test.ts:97-117`, whose `describe` block is named
`an item value that can never compare equal` (itself now inaccurate) and whose
single `it` is `keeps updating, because two inline icons compare equal by name`.

**The aside gap** — `src/inbox/InboxSection.tsx:44` calls `source.useItems()`
directly. `src/inbox/SourceFeed.tsx:67` is the only `useStableItems` caller.
`test-studio/unmemoizedCanary.ts:18-22` is `placement: 'main'` and is
manual-only — nothing in vitest mounts it.

**Repo conventions that apply here**:
- `warnOnce` (`src/warnOnce.ts`) dedupes by message for the process lifetime, so any test asserting on it must reset first. `src/structure/wrapStructure.test.ts:11` shows the convention: call `resetWarnings()` from `src/warnOnce.ts` in `beforeEach`. Without it, assertions become order-dependent inside the file.
- Hook tests use `renderHook`/`rerender` from `@testing-library/react`.

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                                | exit 0, no output   |
| Lint      | `npm run lint`                                      | exit 0, no output   |
| This file | `npx vitest run src/inbox/useStableItems.test.ts`   | all pass            |
| Full tests | `npm test`                                         | all pass            |

## Scope

**In scope:**
- `src/inbox/useStableItems.test.ts` — new tests
- `src/inbox/useStableItems.ts` — **comments only** (correct the false claim)
- `src/inbox/InboxSection.test.tsx` — one new test for the aside gap
- `test-studio/unmemoizedCanary.ts` — a second, `aside`-placement canary

**Out of scope** (do NOT touch, even though they look related):
- `sameValue`'s function-name comparison — it is deliberate and fixes a real bug (`useStableItems.ts:42-46` explains it). Do not "fix" it to make the old test meaningful again.
- `MAX_CONSECUTIVE_ADOPTIONS`' value.
- Adding `useStableItems` to `InboxSection.tsx`. Step 4 only *documents and tests* the gap; closing it changes the aside render path and belongs in its own plan (see Maintenance notes).
- Any change to `SourceFeed.tsx`.

## Git workflow

- Branch: `advisor/065-freeze-test`
- Conventional Commits. `test:` for the tests; if you commit the comment
  correction separately, `docs:`. A single `test:` commit covering both is
  fine.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Test the freeze with a value that genuinely cannot compare equal

Add a test to `src/inbox/useStableItems.test.ts` that allocates a fresh `Date`
per render — `Date` hits the `return false` fallthrough, so it never compares
equal no matter how many renders pass.

Shape (adapt to the file's existing `item()` helper and import style):

```ts
import {resetWarnings} from '../warnOnce'

beforeEach(() => {
  resetWarnings()
})

it('freezes after MAX_CONSECUTIVE_ADOPTIONS rather than looping forever', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const {result, rerender} = renderHook(
    ({n}) => useStableItems([item({title: `v${n}`, timestamp: new Date().toISOString(), dueBy: new Date()})], 'churningDate'),
    {initialProps: {n: 0}},
  )
  // ... rerender well past the cap, then assert the returned array stops changing
})
```

Two things to get right:

1. The churning value must be a **real `Date` object on the item**, not an ISO
   string — a string is a primitive and compares fine. Check `InboxItem`'s type
   (`src/inbox/types.ts`) for a field that accepts a non-primitive, or add the
   churning value under a field the type allows; if no such field exists, say
   so in your report and use the `icon` field with two **differently-named**
   functions instead (different names defeat the name comparison).
2. Assert **all three** observable effects: the returned array stops changing
   (identity stable across further rerenders), `console.warn` was called, and
   the warning text contains `never compare equal`.

**Verify**: `npx vitest run src/inbox/useStableItems.test.ts` → all pass,
including the new test. Then confirm the test is real by temporarily raising
`MAX_CONSECUTIVE_ADOPTIONS` to a huge number — the new test must **fail**.
Restore the constant afterwards. Report that you did this; a freeze test that
passes with the freeze disabled is worthless.

### Step 2: Fix the two inaccurate names and the false claim

1. `src/inbox/useStableItems.ts:115` — replace `Confirmed by test, not assumed.`
   with a statement that is true after Step 1, e.g.:
   `Confirmed by test (\`freezes after MAX_CONSECUTIVE_ADOPTIONS\`), and note the reachable trigger is now a \`Date\`/\`Map\`/class instance, not a function — two functions compare by name below.`
2. `src/inbox/useStableItems.test.ts:97` — the `describe` block named
   `an item value that can never compare equal` now contains a test about
   values that *do* compare equal. Rename it to say what it covers (e.g.
   `an item value allocated fresh every render`) so the two tests inside read
   correctly together.

**Verify**: `grep -n "Confirmed by test" src/inbox/useStableItems.ts` → the
line now names the test that exists.

### Step 3: Add an aside-placement canary in test-studio

`test-studio/unmemoizedCanary.ts` exercises the `main` path. Add a second
export with `placement: 'aside'` and the same deliberately-unmemoized items, so
the manual canary covers both entry points.

Do **not** register it in `test-studio/sanity.config.ts`'s `sources` by
default — read how the existing canary is (or is not) wired and match that, so
the test studio does not start warning on every run. Say in your report how it
is wired.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Cover the aside path in vitest

Add one test to `src/inbox/InboxSection.test.tsx` that renders an `aside`
source whose `useItems` returns a fresh array with a fresh non-comparable value
every render, and assert the section still renders (does not throw, does not
loop).

This documents the current behaviour: `InboxSection` reports only
`open.length`, a number, so today it does **not** close the loop even without
stabilisation. Write the test to assert that, and add a comment saying it is a
guard against that becoming untrue — if someone later makes `InboxSection`
report the items themselves, this test is what catches it.

**Verify**: `npx vitest run src/inbox/InboxSection.test.tsx` → all pass.

## Test plan

Summarised (details in the steps):

- `useStableItems.test.ts`: the freeze test (Step 1), verified real by
  temporarily disabling the cap.
- `InboxSection.test.tsx`: one aside-source render test (Step 4).
- No existing test should change behaviour. If one does, that is a STOP
  condition — this plan adds coverage, it does not alter logic.

**Verify**: `npm test` → all pass, with 2 new tests.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 2 new tests
- [ ] The freeze test was confirmed to fail with `MAX_CONSECUTIVE_ADOPTIONS` raised, and the constant is back to its original value (`git diff src/inbox/useStableItems.ts` shows comment-only changes)
- [ ] `grep -n "Confirmed by test" src/inbox/useStableItems.ts` names a test that exists
- [ ] The `describe` block at `useStableItems.test.ts:97` is renamed to match what it tests
- [ ] `test-studio/unmemoizedCanary.ts` exports an `aside`-placement canary, and your report says how it is wired
- [ ] `git diff --stat src/inbox/useStableItems.ts` shows **no** logic lines changed
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `InboxItem`'s type has no field that accepts a non-primitive value, and the
  two-differently-named-functions route also fails to trigger the freeze. That
  would mean the freeze is unreachable through the public item shape, which is
  a *different* and more interesting finding — report it rather than forcing a
  test through a cast.
- The freeze test still passes with the cap raised. Your test is not exercising
  the branch; fix the test, do not lower the bar.
- Any existing test changes behaviour.
- Adding the aside test reveals that `InboxSection` **does** loop today. That
  is a live bug, not a documentation gap — stop and report it, because it
  changes this plan's priority and scope.

## Maintenance notes

- The reachable trigger for this freeze is now `Date`/`Map`/`Set`/class
  instances, not functions. If `sameValue` ever gains structural comparison for
  one of those, this test's churning value must change with it — otherwise the
  test silently stops covering the branch, which is exactly how the coverage
  was lost the first time.
- A reviewer should ask one question: was the freeze test verified to fail with
  the guard disabled? That is the only thing distinguishing it from the test it
  replaces.
- Deferred out of this plan, deliberately: **wrapping `InboxSection`'s
  `useItems` in `useStableItems`.** Step 4 proves the aside path is currently
  safe (it reports a number, not the items), so closing the gap is prevention
  rather than a fix, and it changes a render path on the pane that has already
  been taken down three times. It wants its own plan and its own verification.
