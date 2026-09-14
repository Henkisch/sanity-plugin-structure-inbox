# Plan 003: Make one failing source cost one card, not the whole pane

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 30e3782..HEAD -- src/inbox/Inbox.tsx src/inbox/InboxSection.tsx src/ui/SectionCard.tsx src/ui/SectionErrorBoundary.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e3782`, 2026-09-09

## Why this matters

`SectionCard` renders an error boundary and its comment states the intent
plainly: "one source with a bad query should cost the editor that one group,
not their whole inbox". That is not what the component tree does.

`InboxSection` calls `source.useItems()` in its **own render body**, then
returns a `<SectionCard>` whose boundary wraps only the children it was
handed. A hook that throws does so while `InboxSection` is rendering —
*above* the boundary, which has not mounted yet. React unwinds past it to the
next boundary up, which is the Studio's, and the entire Inbox pane is replaced
by a crash screen.

This is not hypothetical. `openTasks` calls `useAddonDataset()`, and Sanity's
implementation **throws** `useAddonDataset: missing context value` when no
provider is mounted — which is the case in a Studio with tasks disabled. The
source's own comment claims this "surfaces here as an empty list rather than an
error"; it does not. `upcomingReleases` has the same exposure through
`useActiveReleases`. Any third-party source that throws on a bad config takes
the pane down with it — the pane editors are *redirected to on landing*.

## Current state

The hook call, `src/inbox/InboxSection.tsx:31-35`:

```tsx
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, view, compact = false, onCount} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, resolve} = source.useItems()
```

The boundary, `src/ui/SectionCard.tsx:71-97` — note it wraps `{children}` only,
and that `{toolbar}` and the error branch are outside it:

```tsx
      {toolbar}

      {error ? (
        <Box padding={3}>
          ...
        </Box>
      ) : (
        <SectionErrorBoundary onCatch={setCaughtError}>{children}</SectionErrorBoundary>
      )}
    </Card>
  )
}
```

`InboxSection` passes its rows in as `children` (`src/inbox/InboxSection.tsx:119+`),
so by the time the boundary exists, `useItems()` has already run.

The boundary component itself, `src/ui/SectionErrorBoundary.tsx`, is a plain
class component with an `onCatch` prop. It is correct; only its *position* is
wrong.

Where sections are rendered, `src/inbox/Inbox.tsx` — two call sites, one per
column (main and aside), each mapping over sources and rendering
`<InboxSection ... key={source.name} />`.

Repo conventions:
- All pane UI is built from `@sanity/ui` primitives and its tokens — no raw
  pixel values, no CSS files. See `src/ui/SectionCard.tsx` for the house style.
- Comments state *why*. If you move code whose comment asserts something, fix
  the comment in the same commit — a stale comment here is what allowed this
  bug to survive review.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0, no output   |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `src/inbox/Inbox.tsx`
- `src/inbox/InboxSection.tsx`
- `src/ui/SectionCard.tsx`
- `src/ui/SectionErrorBoundary.tsx`
- `src/inbox/sources/openTasks.ts` (comment correction only)
- `src/i18n/locales/en-US.ts` (if a new string is needed)

**Out of scope** (do NOT touch):
- `src/inbox/InboxRow.tsx`, `src/inbox/SelectionActions.tsx`.
- The behaviour of `SectionCard`'s existing `error` prop path — a source that
  *reports* an error in its result must keep rendering the same error card.
  This plan is about a source that *throws*.
- `src/store/**`.

## Git workflow

- Branch: `advisor/003-isolate-source-errors`
- Conventional commits, e.g. `fix: contain a throwing source to its own card`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Put a boundary around the component that calls the hook

The boundary must wrap `InboxSection` itself, not live inside it. In
`src/inbox/Inbox.tsx`, wrap each rendered `<InboxSection />` — both the main
column and the aside column call sites — in `<SectionErrorBoundary>`.

Because the boundary now sits outside the card, a thrown error means no card is
rendered at all. That is worse than a card showing an error, so give the
boundary a fallback: render a `SectionCard` with the source's `title` and
`icon` and the caught error passed to its existing `error` prop. Add a
`fallback` prop to `SectionErrorBoundary` (a `ReactNode`, or a
`(error: Error) => ReactNode`) and render it instead of `children` once an
error has been caught.

Keep the API of `SectionErrorBoundary` otherwise unchanged.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Remove the now-redundant inner boundary

In `src/ui/SectionCard.tsx`, replace
`<SectionErrorBoundary onCatch={setCaughtError}>{children}</SectionErrorBoundary>`
with `{children}`, and delete the now-unused `caughtError` state, the
`setCaughtError` callback and the `SectionErrorBoundary` import. The `error`
prop path stays exactly as it is.

Update the component's doc comment: it currently claims the card provides
error isolation. It no longer does — the isolation is at the call site in
`Inbox.tsx`. Say that, and say where.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0;
`npm run lint` → exit 0 (this catches any unused import you missed).

### Step 3: Correct the false comment in `openTasks`

`src/inbox/sources/openTasks.ts` claims a Studio without tasks "surfaces here
as an empty list rather than an error". Sanity's `useAddonDataset` throws when
no provider is mounted. Correct the comment to say the source throws and is
contained by the boundary in `Inbox.tsx`.

Do **not** attempt to make the hook not throw — guarding the beta APIs is plan
008's job and depends on this boundary existing.

**Verify**: `grep -n "empty list rather than an error" src/inbox/sources/openTasks.ts`
→ no matches.

### Step 4: Tests

See the Test plan.

**Verify**: `npx vitest run` → all pass.

## Test plan

Create `src/inbox/Inbox.test.tsx`. The jsdom environment and
`@testing-library/react` are already configured (`vitest.config.ts`,
`vitest.setup.ts`) — this is their first use, so keep it simple.

Wrap the render in Sanity UI's `ThemeProvider` with `buildTheme()`, following
the pattern used by the sibling repo's component tests; if that proves to need
more Studio context than a unit test should carry, render `SectionErrorBoundary`
directly with a child that throws, and assert the fallback appears. Either is
acceptable — prefer the smallest thing that proves the behaviour.

Cases:
1. A source whose `useItems` throws renders an error card **and** the sibling
   source's card still renders. This is the regression; it fails before the fix.
2. A source that returns `{items: [], error}` still renders the existing error
   card (no behaviour change).

Suppress the expected `console.error` from React's boundary logging so the run
stays readable — `vi.spyOn(console, 'error').mockImplementation(() => {})`,
restored afterwards (`restoreMocks: true` is already set in `vitest.config.ts`).

**Verification**: `npx vitest run src/inbox/Inbox.test.tsx` → all pass.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0, including a test that a throwing source leaves
      its sibling section rendered
- [ ] `grep -n "SectionErrorBoundary" src/ui/SectionCard.tsx` returns no matches
- [ ] `grep -n "SectionErrorBoundary" src/inbox/Inbox.tsx` returns a match
- [ ] `npm run build` prints `[success]`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `src/ui/SectionCard.tsx` no longer matches the excerpt above.
- Rendering `InboxSection` in a test requires mounting a full Sanity Studio
  provider tree. If a `ThemeProvider` plus a hand-written source is not enough,
  fall back to testing `SectionErrorBoundary` directly and say so in your
  report — do not build a Studio harness inside this plan.
- Moving the boundary changes what the existing `error`-prop path renders.

## Maintenance notes

- The rule to preserve: **the boundary must always sit outside whatever calls
  `source.useItems()`**. If sections are ever refactored so the hook moves, the
  boundary moves with it.
- A reviewer should check `Inbox.tsx` wraps *both* column call sites, not just
  the main one.
- Plan 008 (beta-API containment) assumes this boundary exists and works;
  landing 008 first would leave the pane crashable.
