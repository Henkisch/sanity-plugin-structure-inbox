# Plan 007: Put the jsdom harness to work on the "mark as done" path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9b9709..HEAD -- src/inbox/InboxSection.tsx src/store/useDismissals.ts src/inbox/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans 001, 002, 003 — **all merged**; their behaviour is live on `main`
- **Category**: tests
- **Planned at**: commit `c9b9709`, 2026-09-09 (refreshed after plans 001-006 merged)

## Why this matters

This repo is configured for component testing and has never done any. `jsdom`,
`@testing-library/react` and `@testing-library/dom` are installed;
`vitest.config.ts` sets `environment: 'jsdom'` with a comment saying "the
meaningful units here are DOM-bound"; `vitest.setup.ts` stubs `ResizeObserver`
and `matchMedia` specifically because Sanity UI needs them. Not one test
imports any of it — all 34 tests are pure-function tests that would run in
plain Node.

What that leaves untested is the code with real consequences. `confirmSelection`
in `InboxSection` is the whole product decision in one callback, and its most
important guarantee — **an item whose `resolve` failed must stay in the inbox**
— is asserted by a comment and nothing else. If the `Promise.allSettled`
result-to-target index mapping is ever broken, an editor's task is hidden from
them while still open for the team, for up to 90 days, with only a
`console.error` as evidence.

This plan is the harness the later plans lean on: 008 and 009 both restructure
code paths that currently have no test at all.

## Current state

`src/inbox/InboxSection.tsx:85-115` — the callback under test:

```tsx
  const confirmSelection = useCallback(async () => {
    if (view === 'done') {
      for (const item of selected) dismissals.restore(source.name, item.id)
      setSelectedIds([])
      return
    }

    if (!resolve) {
      for (const item of selected) dismissals.dismiss(source.name, item.id)
      setSelectedIds([])
      return
    }

    const targets = [...selected]

    setBusy(true)
    try {
      // `allSettled` rather than `all`: one item failing should not strand the
      // others, and each is marked done only once its own resolve succeeded.
      const results = await Promise.allSettled(targets.map((item) => resolve(item)))

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') dismissals.dismiss(source.name, targets[index].id)
        else console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
      })

      setSelectedIds([])
    } finally {
      setBusy(false)
    }
  }, [view, resolve, selected, dismissals, source.name])
```

`InboxSection`'s props (`src/inbox/InboxSection.tsx:15-21`) — note `dismissals`
is **injected**, which is what makes this testable without a Sanity client:

```ts
interface InboxSectionProps {
  source: InboxSource
  dismissals: Dismissals
  view: InboxView
  compact?: boolean
  onCount: (sourceName: string, count: number) => void
}
```

`Dismissals` (`src/store/useDismissals.ts`) is `{state, dismiss, restore}` —
trivially fakeable with `vi.fn()`.

`InboxSource` (`src/inbox/types.ts`) requires `name`, `title`, and
`useItems(): InboxSourceResult`, where the result is
`{items, loading?, error?, resolve?}`. A test source is a plain object whose
`useItems` returns a literal — no rxjs, no client.

Existing test conventions — read `src/store/dismissals.test.ts` first:
`describe`/`it`, plain `expect`, no mocking framework beyond `vi.fn()`/`vi.spyOn`,
and `restoreMocks: true` is already set in `vitest.config.ts`. Note
`src/inbox/Inbox.test.tsx` already exists (added by plan 003) and shows the
working `ThemeProvider` + `buildTheme()` render setup — **read it first and
follow it**; it also documents that rendering `Inbox` itself needs a full Studio
provider tree, which is why plan 003 tests the exported `BoundedSection`. so mocks reset
between tests. Comments in tests explain *why a case matters*, not what the
code does.

## Commands you will need

| Purpose        | Command                                        | Expected on success |
|----------------|------------------------------------------------|---------------------|
| Typecheck      | `npx tsc --noEmit -p tsconfig.json`            | exit 0              |
| Run one file   | `npx vitest run src/inbox/InboxSection.test.tsx`| all pass            |
| Tests          | `npx vitest run`                               | all pass            |
| Lint           | `npm run lint`                                 | exit 0              |

## Scope

**In scope** (create):
- `src/inbox/InboxSection.test.tsx`
- `src/store/useDismissals.test.tsx`
- `src/test/renderWithTheme.tsx` (or similar small shared helper, if needed)

**Out of scope** (do NOT modify):
- **Any production file.** This plan adds tests only. If a test cannot be
  written without changing production code, that is a STOP condition — the
  change belongs in its own plan.
- `src/inbox/InboxRow.tsx`, `SelectionActions.tsx`, `RelativeTime.tsx`,
  `src/ui/SectionCard.tsx` — presentational; covered incidentally.
- `src/inbox/sources/upcomingReleases.ts` — a thin adapter over a Sanity hook;
  a test would mostly assert the mock.
- `vitest.config.ts`, `vitest.setup.ts` — already correct.

## Git workflow

- Branch: `advisor/007-component-tests`
- Conventional commits, e.g. `test: cover the mark-as-done path in InboxSection`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Establish the render helper

Sanity UI components need a theme in context. Create a small helper that wraps
`@testing-library/react`'s `render` with Sanity UI's `ThemeProvider` and
`buildTheme()`:

```tsx
import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
```

Check the exact import path for `buildTheme` against the installed
`@sanity/ui` version before writing it — the package exposes subpath exports
and guessing wastes a cycle.

Prove the helper works by rendering `InboxSection` with a source returning one
item and asserting the item's title is on screen.

**Verify**: `npx vitest run src/inbox/InboxSection.test.tsx` → 1 passing test.

### Step 2: Test the partial-failure path — the reason this plan exists

Build a source with three items and a `resolve` that **rejects for exactly one
of them** and resolves for the other two. Select all three, click the confirm
action, and assert:

- `dismissals.dismiss` was called exactly twice
- it was called with the two ids whose `resolve` succeeded
- it was **not** called with the id whose `resolve` rejected

Silence the expected `console.error` with `vi.spyOn(console, 'error')`.

To drive the interaction, prefer clicking real controls with
`@testing-library`'s `screen`/`userEvent` — the checkboxes have an accessible
name via `aria-labelledby`, and the action button's label comes from
`src/i18n/locales/en-US.ts` (`action.markDone` → "Mark as done"). If the i18n
provider is not available in the test environment and labels render as raw
keys, assert on the key instead and note it in your report.

**Verify**: `npx vitest run src/inbox/InboxSection.test.tsx` → the new test
passes; then temporarily change `result.status === 'fulfilled'` to
`!== 'rejected'`… **no** — do not modify production code. Instead confirm the
test's strength by asserting the exact call arguments, not just the count.

### Step 3: Test the two simpler branches

- **No `resolve`**: a source without `resolve`, items selected, confirm →
  `dismiss` called once per selected item, and nothing throws.
- **Done tab**: `view="done"` with dismissed items → `restore` called once per
  selected item, and `dismiss` is not called at all.
- **The open/done split reads `changedAt`, not `timestamp`** (closes a gap plan
  001 left open): give a source one item whose `timestamp` is a year in the
  future and whose `changedAt` is in the past, dismiss it, and assert it lands
  in Done. Reverting `InboxSection` to `item.timestamp` must turn this test red
  — verify that it does before considering the case written. Today only a grep
  criterion guards this.

**Verify**: `npx vitest run src/inbox/InboxSection.test.tsx` → all pass.

### Step 4: Characterize `useDismissals`

Create `src/store/useDismissals.test.tsx` using `renderHook`. The hook calls
`useClient` and `useCurrentUser` from `sanity`; mock the module with
`vi.mock('sanity', ...)`, returning a fake client whose `fetch` returns a
promise you control and whose `transaction()` returns a chainable stub
(`createIfNotExists` → `patch` → `commit`, each returning the stub, with
`commit` returning a resolved promise).

Plan 002 is merged, so assert the behaviour that is **now live**. The hook has
`loadedRef` (set once a read settles) and `hasLocalEditRef` (set on the first
tick, never cleared), and the persist effect refuses to write until
`loadedRef.current` is true. Read `src/store/useDismissals.ts` before writing
these — it is not what the original plan described.

1. A dismissal made *before* the initial fetch resolves survives the late load.
2. A dismissal is persisted — `commit` called once — after a tick.
3. A read failure does not lead to a blind overwrite: with `fetch` rejecting,
   a subsequent tick must not call `commit`.

All three should pass against the current code. If one does not, that is a
finding — report it rather than adjusting the hook, which is out of scope.

**Verify**: `npx vitest run src/store/useDismissals.test.tsx` → all pass.

### Step 5: Full suite

**Verify**: `npx vitest run` → all pass; `npx tsc --noEmit -p tsconfig.json` →
exit 0; `npm run lint` → exit 0.

## Test plan

This plan *is* the test plan. Coverage target, in priority order:

1. `confirmSelection` partial failure (step 2) — the one that matters.
2. `confirmSelection` no-`resolve` and done-tab branches (step 3).
3. `useDismissals` load/write ordering (step 4).

Model the file structure on `src/store/dismissals.test.ts`. Keep each test's
setup visible inside the test — a shared factory is fine, but a reader should
not have to scroll to learn what the source under test returns.

## Done criteria

ALL must hold:

- [ ] `src/inbox/InboxSection.test.tsx` exists with at least 4 tests
- [ ] One of them asserts `dismiss` is called with exactly the succeeding ids
      and not the failing one
- [ ] `src/store/useDismissals.test.tsx` exists with at least 3 tests
- [ ] `npx vitest run` exits 0; total test count is at least 51 (42 currently on `main`, + 7 new)
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git status` shows **no modified production files** — only new test files
      (and the optional render helper)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Rendering `InboxSection` needs more Studio context than a `ThemeProvider` —
  e.g. it demands a workspace, a router, or a client provider. Report what it
  needs; do not build a Studio harness or start mocking `sanity` wholesale for
  the component tests.
- A test can only pass by changing production code. Report the change you would
  need — that is a finding, not a licence to edit.
- `useTranslation` in `InboxSection` throws without a Studio i18n provider. If
  so, mock `sanity`'s `useTranslation` to return `{t: (k: string) => k}` and
  assert on keys.
- The suite becomes slower than ~10s, which suggests something real is being
  mounted that should be faked.

## Maintenance notes

- These tests are the safety net for plans 008 and 009. Land this first.
- The `dismissals` prop being injected into `InboxSection` is what makes it
  testable. Keep it that way — if a future refactor has the section call
  `useDismissals` itself, these tests get much harder and the seam is lost.
- A reviewer should check the partial-failure test asserts on *arguments*, not
  just call counts; a count-only assertion passes even if the wrong item was
  dismissed.
