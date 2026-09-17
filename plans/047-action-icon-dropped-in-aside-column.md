# Plan 047: A source's `action.icon` renders in the main column but is silently dropped in the aside column

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/inbox/InboxSection.tsx src/inbox/Inbox.tsx src/inbox/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

`InboxSourceResult.action` (the per-source "scan"/"refresh"-style button —
see `linkCheckerFindings.ts`'s "Scan for issues" for the one built-in
example) carries an optional `icon`. The main column's own button
(`Inbox.tsx`) renders that icon. The aside column's equivalent button
(`InboxSection.tsx`'s `SectionCard` `badge`) never reads `action.icon` at
all — it is simply not wired through. `placement` (main vs. aside) is a
per-source config choice an integrator makes; the same source, action, and
icon should look the same regardless of which column it ends up in. Today
it silently doesn't, for no reason the integrator controls or can see from
their own config. The fix is additive and mechanical: pass the same prop
through in one more place.

## Current state

- `src/inbox/types.ts` — `InboxSourceResult.action.icon`'s doc comment
  (around the `action` field definition): "Shown on the button before the
  label. Omit for a plain text button." The field is placement-agnostic —
  nothing in its type or docs says it only applies to one column.

- `src/inbox/Inbox.tsx:1210-1220` — the main-column action button (current
  code):
  ```tsx
  <Button
    disabled={actionRunning}
    fontSize={1}
    icon={action.icon}
    mode="ghost"
    onClick={handleAction}
    padding={2}
    text={actionRunning ? (action.pendingLabel ?? action.label) : action.label}
  />
  ```
  (Line numbers approximate — find this exact button by searching for
  `action.pendingLabel` in `Inbox.tsx`.)

- `src/inbox/InboxSection.tsx:107-117` — the aside-column equivalent
  (current code, the `badge` prop passed into `SectionCard`):
  ```tsx
  <SectionCard
    badge={
      action && (
        <Button
          disabled={actionRunning}
          fontSize={1}
          mode="ghost"
          onClick={handleAction}
          padding={2}
          text={actionRunning ? (action.pendingLabel ?? action.label) : action.label}
        />
      )
    }
  ```
  Note: no `icon` prop at all. Everything else about the two buttons
  (disabled state, font size, mode, padding, label logic) already matches
  exactly — this is the one prop missing.

- Confirmed via `grep -n "icon={action" src/inbox/*.tsx` that
  `icon={action.icon}` appears exactly once in the whole codebase, at the
  main-column site above. `linkCheckerFindings.ts` is the one built-in
  source that sets a real `action.icon` (`SearchIcon`) today, and its own
  `placement` is configurable by the integrator (defaults to `'main'`) —
  so this bug is only latent until someone configures it into `'aside'`,
  but it is a real, reachable gap in supported configuration.

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|-----------------------------------------------------|----------------------|
| Typecheck | `npm run typecheck`                                  | exit 0, no errors    |
| Lint      | `npm run lint`                                       | exit 0               |
| Tests     | `npx vitest run src/inbox/InboxSection.test.tsx`     | all pass             |
| Full test | `npx vitest run`                                     | all pass             |
| Build     | `npm run build`                                      | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope** (the only files you should modify):
- `src/inbox/InboxSection.tsx`
- `src/inbox/InboxSection.test.tsx` (add a test)

**Out of scope**:
- `src/inbox/Inbox.tsx` — already correct; referenced only as the pattern
  to match. Do not modify.
- `src/inbox/types.ts` — the `action.icon` field already exists and is
  correctly placement-agnostic; no type change needed.
- `src/inbox/sources/linkCheckerFindings.ts` — do not add or change any
  source's own `action.icon` value; this plan only fixes the render path.

## Git workflow

- Branch: `advisor/047-action-icon-aside-column`
- One commit: `fix: pass action.icon through to the aside column's own action button`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `icon={action.icon}` to the aside-column button

In `src/inbox/InboxSection.tsx`, inside the `badge={action && (...)}` block,
add `icon={action.icon}` to the `<Button>`, in the same alphabetical
position Sanity UI/this codebase's own prop-ordering convention uses
(props in this file are alphabetized — insert `icon` between `fontSize`
and `mode`, matching the main-column button's own prop order in
`Inbox.tsx`).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Confirm no visual regression when `action.icon` is undefined

`Button`'s `icon` prop already handles `undefined` gracefully in every
other call site in this codebase (e.g. `Inbox.tsx`'s own main-column
button passes `action.icon` unconditionally today and works fine whether
or not a source sets one) — no extra guard is needed. Just confirm by
reading `Button`'s type from `@sanity/ui` (or by finding another call site
in this repo that passes a possibly-`undefined` `icon`) that this is safe.

**Verify**: `npm run lint` → exit 0 (no new type-safety complaints).

## Test plan

- Add one test to `src/inbox/InboxSection.test.tsx`: render `InboxSection`
  with a source whose `action` includes a real `icon` (e.g. reuse
  `SearchIcon` from `@sanity/icons/Search`, matching
  `linkCheckerFindings.ts`'s own choice), and assert the rendered action
  button's DOM contains an `<svg>` (or whatever DOM shape this codebase's
  icon components render — check an existing test elsewhere in this repo
  that already asserts an icon rendered, e.g. search test files for
  `querySelector('svg')` or similar, and follow that exact pattern).
- Follow the existing render-test structure already in
  `InboxSection.test.tsx` (same mock-source/`renderWithTheme` setup other
  tests in that file use) rather than inventing a new harness.
- Verification: `npx vitest run src/inbox/InboxSection.test.tsx` → all
  pass, including the new test. Then `npx vitest run` (full suite) → all
  pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0; a new test confirming the aside action
      button renders its `icon` exists and passes
- [ ] `npm run build` exits 0
- [ ] `git status` shows only `src/inbox/InboxSection.tsx` and
      `src/inbox/InboxSection.test.tsx` changed
- [ ] `plans/README.md` status row for plan 047 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `InboxSection.tsx`'s `badge` button no longer matches the excerpt above
  (drift since this plan was written).
- `SectionCard`'s `badge` prop type does not accept a `ReactNode` with an
  icon-carrying `Button` the way assumed here — re-read `SectionCard.tsx`'s
  own prop types before assuming the fix is this simple.
- No existing test file establishes a clear "assert an icon rendered"
  pattern anywhere in this repo — in that case, write the simplest
  reasonable assertion (checking for the icon component's own rendered
  output) and note in your final report that you had to establish this
  pattern rather than follow one.

## Maintenance notes

- If `SectionCard`'s `badge` prop is ever refactored to take structured
  data (icon + label + handler) instead of a pre-built `ReactNode`, this
  fix's exact line will move — but the underlying requirement (icon must
  render in both columns) stays the same and should be preserved.
- A reviewer should visually confirm in `test-studio` (configure
  `linkCheckerFindings` with `placement: 'aside'`) that the search icon now
  actually appears on the "Scan for issues" button in the sidebar.
