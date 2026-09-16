# Plan 034: Remove the "Try again" button — it is a permanent no-op

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/ui/SectionCard.tsx src/ui/SectionErrorBoundary.tsx src/inbox/InboxSection.tsx src/i18n/locales/en-US.ts`
> If any of these changed since this plan was written, re-read them before
> proceeding — compare against the excerpts below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`SectionCard.tsx:44` defines `handleRetry` as a literal no-op:
`useCallback(() => {}, [])`. It is wired to a real, visible, enabled button
(`text={t('source.error.retry')}`, i.e. "Try again") that an editor can
click. Clicking it does *nothing*, in either of the two cases this button
can appear for:

1. **A thrown error** (`BoundedSection`'s fallback in `Inbox.tsx:274-298`,
   via `SectionErrorBoundary`): `SectionErrorBoundary.tsx` is a class
   component whose `state.error`, once set by
   `getDerivedStateFromError`, is **never cleared** — there is no reset
   method anywhere in the class (confirmed: only `getDerivedStateFromError`
   and `componentDidCatch` touch `state`). Once tripped, this boundary shows
   the fallback forever, regardless of any click.
2. **A reported error** (`InboxSection.tsx:122`, `error={error}` from
   `const {items, loading, error, ...} = source.useItems()` at
   `InboxSection.tsx:44`): this `error` is whatever the source's own hook
   currently reports, re-evaluated on every render. `handleRetry` has no
   local state to clear and triggers no re-fetch — the comment already
   admits this at `SectionCard.tsx:41-43`: "retrying is only ever
   meaningful if the source itself stops reporting one," which nothing
   about clicking this button causes.

A button that visibly exists, looks interactive, and does nothing when
clicked is worse than no button — it tells the editor "try this" and lies.
The honest, in-scope fix is to remove the dead affordance, not to build a
real retry mechanism: making retry actually work needs a `refresh()` path
threaded through `InboxSource`/`liveQuery$` (recorded separately as
Direction A in `plans/README.md`, "make sources refreshable" — a bigger,
maintainer's-call design decision, not a bug fix).

## Current state

- `src/ui/SectionCard.tsx:37-45`:
  ```ts
  export function SectionCard(props: SectionCardProps) {
    const {title, badge, note, toolbar, error, children} = props
    const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

    // A reported error comes back from the source's own hook on every render —
    // there is no local "caught" state here to clear, so retrying is only ever
    // meaningful if the source itself stops reporting one.
    const handleRetry = useCallback(() => {}, [])
  ```
- `src/ui/SectionCard.tsx:106-124` (the whole error-branch render):
  ```tsx
  {error ? (
    <Box padding={3}>
      <Stack gap={3}>
        <Text size={1} weight="medium">
          {t('source.error.title')}
        </Text>
        <Text muted size={1}>
          {error.message}
        </Text>
        <Flex>
          {/* Ghost mode: recovering from an error is not the primary thing
              on this pane, and a filled button would say otherwise. */}
          <Button
            fontSize={1}
            mode="ghost"
            onClick={handleRetry}
            text={t('source.error.retry')}
          />
        </Flex>
      </Stack>
    </Box>
  ) : (
    children
  )}
  ```
- `src/ui/SectionErrorBoundary.tsx` — the whole file (52 lines). Confirmed:
  no method anywhere resets `state.error` once set. `Component<...>`'s
  default React reset semantics only apply if the boundary itself is
  unmounted/remounted (e.g. via a changed `key` upstream) — nothing in this
  file or its one caller (`Inbox.tsx:287`) does that.
- `src/i18n/locales/en-US.ts:57`: `'source.error.retry': 'Try again',` — the
  only consumer of this key is the button being removed.
- No test currently exercises `handleRetry`'s click behavior (confirmed:
  `grep -rn "Try again\|source.error.retry" src/**/*.test.tsx` returns
  nothing) — removing the button breaks no existing test.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/ui/SectionCard.tsx` (remove the button, `handleRetry`, and the now-
  unused `useCallback` import if nothing else in the file needs it — check
  first)
- `src/i18n/locales/en-US.ts` (remove the now-dead `source.error.retry` key)

**Out of scope**:
- `src/ui/SectionErrorBoundary.tsx` — no change; a real reset mechanism is
  a bigger, separate design decision (Direction A), not this bug fix.
- `src/inbox/InboxSection.tsx`, `src/inbox/Inbox.tsx` — the `error` prop
  plumbing itself is unaffected; only the dead button inside `SectionCard`
  goes.
- Any other locale file under `src/i18n/locales/` other than `en-US.ts` —
  check whether any exist and, if they mirror this key, remove it there
  too (same scope, just confirm the file list first).

## Git workflow

- Commits land directly on `main`. Message style: `fix: remove the "Try
  again" button — it never did anything`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Remove the button and its dead handler

In `src/ui/SectionCard.tsx`, delete the `handleRetry` declaration and the
`<Button ... onClick={handleRetry} .../>` element. Keep the surrounding
`<Flex>` only if something else still needs it — if the button was its
only child, remove the `<Flex>` wrapper too (check the JSX around it: the
comment `{/* Ghost mode: ... */}` goes with it). The error card should
still show `source.error.title` and `error.message` — only the retry
affordance goes.

Remove the `useCallback` import from `'react'` at the top of the file if
nothing else in it still uses `useCallback` — check first
(`grep -n "useCallback" src/ui/SectionCard.tsx`).

**Verify**: `npm run typecheck` → exit 0. `grep -n "handleRetry\|Try again"
src/ui/SectionCard.tsx` → no matches.

### Step 2: Remove the now-dead i18n key

In `src/i18n/locales/en-US.ts`, remove the `'source.error.retry': 'Try
again',` line. Check `src/i18n/locales/` for any other locale files and
remove the same key there if present.

**Verify**: `grep -rn "source.error.retry" src/` → no matches anywhere.

### Step 3: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

No new test needed — this removes dead code with no existing test coverage
(confirmed in "Current state" above). The full suite passing with no
changes needed elsewhere is the regression guard.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, no new failures
- [ ] `npm run build` exits 0
- [ ] `grep -rn "source.error.retry\|handleRetry" src/` returns nothing
- [ ] The error card in `SectionCard.tsx` still shows the error title and
      message — only the button is gone
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 034 updated

## STOP conditions

- Some other locale file under `src/i18n/locales/` has diverged from
  `en-US.ts` in a way that makes removing `source.error.retry` there
  ambiguous (e.g. a key that doesn't exist, or exists under a different
  name) — report rather than guessing.
- Any test (not found during this plan's own recon) turns out to exercise
  `handleRetry` or the retry button's presence — re-read it and adjust
  rather than deleting a real test's assertion silently.

## Maintenance notes

If a real retry mechanism is ever built (Direction A in `plans/README.md`
— sources gaining a `refresh()` capability), it belongs back in this same
error card, wired to that real mechanism — not as a re-add of this no-op.
