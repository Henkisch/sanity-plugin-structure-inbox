# Plan 046: `SectionCard`'s error state gets the same critical-red tone every other error in this pane already uses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/ui/SectionCard.tsx src/inbox/MergedList.tsx`
> If either in-scope file changed since this plan was written, compare the
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

This plugin renders a source's items either in the main column (via
`MergedList.tsx`) or the sidebar/aside column (via `SectionCard.tsx`, used
by `InboxSection.tsx`). Both columns can show the exact same underlying
fact — "this source failed to fetch its items" — but they render it with
completely different visual weight. A main-column failure is a bright red
`tone="critical"` card; an aside-column failure (e.g. a misconfigured
Releases source) is plain, uncolored body text that looks like ordinary
copy. An editor who has learned "red card = something's actually broken"
from the main list and from every AI-read error card in this pane will
walk right past an aside source's silent failure. This is a one-line fix:
give `SectionCard`'s error branch the same `tone="critical"` treatment
`MergedList.tsx` already uses for the identical condition.

## Current state

- `src/ui/SectionCard.tsx` — renders one source's card in the aside
  column. Its `error` branch, current code (`src/ui/SectionCard.tsx:101-114`):
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
      </Stack>
    </Box>
  ) : (
    children
  )}
  ```
  No `tone` anywhere in this branch. The card's own outer `<Card>` (around
  line 44) also carries no `tone` prop, so it renders at the theme's
  neutral/default background regardless of `error`.

- `src/inbox/MergedList.tsx` — renders the *same* per-source error
  condition for main-column sources, current code
  (`src/inbox/MergedList.tsx:922-931`):
  ```tsx
  return (
    <Stack gap={3}>
      {errors.map((report) => (
        <Card key={report.source.name} padding={3} radius={2} tone="critical">
          <Text size={1}>
            {t(report.source.title)}: {report.error?.message ?? t('source.error.title')}
          </Text>
        </Card>
      ))}
  ```
  Note the different structure here too: one `<Text>` combining title and
  message, versus `SectionCard`'s two separate `<Text>` elements (title
  bold, message muted). Do not unify that structural difference in this
  plan — it is out of scope (see below). Only add the missing `tone`.

- Convention to match: every other error-like surface in this pane already
  uses `tone="critical"` on its containing `Card` — see
  `src/inbox/MergedList.tsx:927` above and the AI-read error cards in
  `src/inbox/Inbox.tsx` (e.g. around line 1350, `tone={... === 'error' ?
  'critical' : 'primary'}`). `SectionCard`'s error branch is the one
  surface in the whole pane that doesn't.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|---------------------------------------------------|----------------------|
| Typecheck | `npm run typecheck`                                | exit 0, no errors    |
| Lint      | `npm run lint`                                     | exit 0               |
| Tests     | `npx vitest run src/ui/SectionCard.test.tsx` (create if absent) / `npx vitest run` for the full suite | all pass |
| Build     | `npm run build`                                    | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — on this repo it has
been observed to reformat far more of the tree than intended (quote-style
and code-block indentation changes across dozens of unrelated files, some
of them historical `plans/*.md` records). Make your edit match the
surrounding style by hand instead.

## Scope

**In scope** (the only files you should modify):
- `src/ui/SectionCard.tsx`
- `src/ui/SectionCard.test.tsx` (create — check first whether this file
  already exists; if it does, add to it instead of overwriting)

**Out of scope** (do NOT touch, even though they look related):
- `src/inbox/MergedList.tsx` — already correct, only referenced here as the
  pattern to match. Do not refactor it to share an implementation with
  `SectionCard`; that structural unification is a separate, larger change
  not covered by this plan.
- The `error` branch's text structure (bold title + separate muted
  message vs. `MergedList`'s single combined line) — leave as-is. Only the
  color/tone is in scope.
- `InboxSection.tsx` — it only passes `error` through to `SectionCard`;
  no change needed there.

## Git workflow

- Branch: `advisor/046-sectioncard-error-tone`
- One commit, conventional-commit style matching this repo's history, e.g.:
  `fix: give SectionCard's error state the same critical tone every other error uses`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `tone="critical"` to `SectionCard`'s error branch

In `src/ui/SectionCard.tsx`, change the error branch's outer container from
a plain `<Box padding={3}>` to a `<Card padding={3} radius={2} tone="critical">`
(match `MergedList.tsx:927`'s `radius={2}` exactly, so the two error cards
read as the same visual family). Import `Card` from `@sanity/ui` if it is
not already imported in this file (check the existing import line at the
top before adding a duplicate).

Resulting shape should be:
```tsx
{error ? (
  <Card padding={3} radius={2} tone="critical">
    <Stack gap={3}>
      <Text size={1} weight="medium">
        {t('source.error.title')}
      </Text>
      <Text muted size={1}>
        {error.message}
      </Text>
    </Stack>
  </Card>
) : (
  children
)}
```

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Confirm nothing else in this file assumed a plain `Box` here

Search for any other reference to this specific `Box` (e.g. a test
querying for a `Box`-specific role, or a snapshot). Run:

```
grep -rn "source.error.title" src/
```

Confirm the only non-test hits are the i18n key definition
(`src/i18n/locales/en-US.ts`) and this one render site.

**Verify**: `npm run lint` → exit 0.

## Test plan

- If `src/ui/SectionCard.test.tsx` does not already exist, create it. Model
  it after `src/inbox/InboxSection.test.tsx`'s existing render-test
  conventions (React Testing Library, `renderWithTheme` if that test
  helper exists — check `src/test/renderWithTheme.tsx` — plain `render`
  from `@testing-library/react` otherwise).
- New test: render `SectionCard` with an `error` prop set (e.g.
  `{message: 'boom'}`) and assert the rendered `Card`/container carries
  `tone="critical"` — either by checking the computed background color is
  the critical tone's, or more simply by asserting the DOM node nearest
  the error text has a `data-ui="Card"` ancestor whose props/attributes
  reflect the critical tone (check how existing tests in this repo assert
  tone — e.g. search `tone="critical"` inside any `*.test.tsx` file for
  the established assertion pattern before inventing a new one).
- If `SectionCard.test.tsx` already exists, add this as one more `it(...)`
  inside its existing `describe` block rather than restructuring the file.
- Verification: `npx vitest run src/ui/SectionCard.test.tsx` → all pass,
  including the new test.
- Also run the full suite once: `npx vitest run` → all pass (435+ tests
  before this change; should be 435+1 or more after).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0; a new test asserting `tone="critical"` on
      `SectionCard`'s error render exists and passes
- [ ] `npm run build` exits 0
- [ ] `git status` shows only `src/ui/SectionCard.tsx` and
      `src/ui/SectionCard.test.tsx` changed
- [ ] `plans/README.md` status row for plan 046 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/ui/SectionCard.tsx`'s error branch does not match the excerpt
  above (the codebase has drifted since this plan was written) — read the
  current code and compare before assuming the fix location is still
  correct.
- `Card` is not importable from `@sanity/ui` in this file for some reason
  (e.g. a local shadowing import) — report what you find instead of
  working around it with a different component.
- A pre-existing `SectionCard.test.tsx` uses a fundamentally different
  testing approach (e.g. snapshot testing) than described above — follow
  its existing pattern instead of introducing a new one, and note the
  deviation in your final report.

## Maintenance notes

- If a future change unifies `SectionCard`'s and `MergedList`'s error
  rendering into one shared component (flagged as a real, separate
  finding — see plans/README.md's "Findings considered and rejected" or
  the direction notes from the 2026-09-17 UI-consistency audit), this
  plan's fix becomes redundant but harmless — the shared component would
  presumably already carry `tone="critical"`.
- A reviewer should visually confirm (in `test-studio`, if available) that
  the aside column's error card now actually reads as "broken," not just
  that the prop is present — Sanity UI's `critical` tone should render a
  red-tinted background matching `MergedList`'s own error cards.
