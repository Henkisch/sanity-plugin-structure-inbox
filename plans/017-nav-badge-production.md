# Plan 017: A live badge on the Studio navbar, for real

> **Executor instructions**: Follow this plan step by step. Every step ends
> in a verification command — run it before moving to the next step. If a
> STOP condition fires, stop and report rather than improvising. When done,
> update this plan's status row in `plans/README.md` — unless a reviewer
> dispatched you and told you they maintain the index.
>
> **This plan depends on Plan 016 (`plans/016-inbox-open-count-provider.md`)
> being DONE first** — it needs `useInboxOpenCount()` to exist. Check
> `plans/README.md`; if 016 is not marked DONE, stop and report rather than
> building against a hook that does not exist yet.
>
> **Drift check (run first)**: `git diff --stat d2cc473..HEAD -- src/plugin.tsx src/studio/inboxCountLayout.tsx src/studio/createActiveToolLayout.tsx`
> If any in-scope file changed since this plan was written beyond what Plan
> 016 itself introduced, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive `studio.components.navbar` override; composes with
  Sanity's own default rendering and with any other plugin's navbar
  override — see "Why this matters" for why that composition is already
  proven safe in this codebase)
- **Depends on**: 016
- **Category**: direction (production version of Plan 011's spike)
- **Planned at**: commit `d2cc473`, 2026-09-14

## Why this matters

Plan 011's spike confirmed, against a real running Studio: `studio.components.navbar`
is real, composes with Sanity's own default navbar via `renderDefault` (no
reimplementation needed), and a badge built on it updates live with no
manual refresh. It also confirmed the *other* candidate mechanism
(`Tool.icon`) does not work in the common case — Sanity's own `ToolMenu`
renders tool tabs as plain text, never invoking a tool's `icon` component at
all under a normal desktop, few-tools layout. This plan builds the
`studio.components.navbar` version for real, using Plan 016's
`useInboxOpenCount()` instead of the spike's own simplified,
throwaway-per-source count.

**One open question from Plan 011's Findings is resolved, not just carried
forward**: whether this plugin's own navbar override would break if a
consuming Studio also registers its own `studio.components.navbar`. It will
not. `test-studio/plugins/activeToolLayoutProbe.tsx` already exists in this
repo specifically to prove Sanity composes multiple plugins' overrides of
the *same* `studio.components` slot by chaining them through
`renderDefault` — its own doc comment: *"`useMiddlewareComponents` composes
overrides through `renderDefault`, and a plugin that forgets to call it
silently swallows every other plugin's contribution."* As long as this
plan's navbar override calls `props.renderDefault(props)` (it does — see
Step 1), it composes correctly with any number of other plugins' navbar
overrides automatically. No `warnOnce`-style degrade path is needed for
this; that earlier open question is now closed.

## Current state

**`plans/011-investigate-nav-badge.md`'s own committed spike**
(`test-studio/plugins/navbarBadgeSpike.tsx`, whole file — the working
mechanism this plan turns into a real, shipped feature):

```tsx
export const navbarBadgeSpike = definePlugin({
  name: 'test-studio/navbar-badge-spike',
  studio: {
    components: {
      navbar: function BadgedNavbar(props: NavbarProps) {
        const count = useSpikeDraftsCount()

        return (
          <Fragment>
            {props.renderDefault(props)}
            {count !== null && count > 0 && (
              // `position: fixed` deliberately sidesteps whatever stacking
              // context Studio's own navbar establishes (it's plausibly
              // itself `position: sticky`/`fixed` with its own z-index) —
              // pinning to the viewport corner is the crude-but-reliable way
              // to prove the badge paints at all in this throwaway spike.
              <span
                style={{
                  position: 'fixed', top: 6, left: 6, minWidth: 16, height: 16,
                  padding: '0 4px', borderRadius: 999, background: '#cf3f52',
                  color: '#fff', fontSize: 10, lineHeight: '16px',
                  textAlign: 'center', fontWeight: 700, pointerEvents: 'none',
                  zIndex: 2147483647,
                }}
              >
                {count}
              </span>
            )}
          </Fragment>
        )
      },
    },
  },
})
```

The spike's own note on why the naive version failed first: *"an initial
version wrapped `renderDefault(props)` and the badge in a `<Box style={{
position: 'relative'}}>`... this mounted and fetched correctly but never
painted visibly, almost certainly because Studio's own navbar establishes
its own stacking context... Switching to `position: fixed` on the badge
itself... fixed this immediately."* Do not reintroduce the wrapping
positioned `Box` — render `renderDefault(props)` and the badge as plain
siblings, exactly as above.

**Plan 016's `useInboxOpenCount()`** (once 016 is DONE — read
`src/studio/inboxCountLayout.tsx` directly to confirm its exact final
shape before writing this plan's code; the signature this plan depends on):

```ts
export function useInboxOpenCount(): number | null
```

**`src/plugin.tsx`** — read it fresh (Plan 016 will have already added a
`layout` entry to `studio.components`; this plan adds a `navbar` entry
alongside it, not instead of it):

```tsx
studio: {
  components: {
    activeToolLayout: createActiveToolLayout(config),
    layout: createInboxCountLayout(config), // added by Plan 016
  },
},
```

**Repo conventions to match**:

- A `studio.components.*` override lives in its own file under `src/studio/`,
  built by a `create<Slot>(config)` factory — see
  `src/studio/createActiveToolLayout.tsx`.
- Every such override calls `props.renderDefault(props)` — never renders
  instead of Sanity's own default, always alongside or around it.
- `@sanity/ui`'s `Badge` component is this codebase's existing convention
  for a small numeric/status chip (used previously in `SectionCard`'s header
  before this session's UI-consistency pass removed it from there
  specifically — not because `Badge` itself was wrong, but because a count
  chip on every section header read as redundant next to the rows
  themselves; a single badge on the navbar has no such redundancy problem,
  since nothing else in the Studio chrome shows this number).

## Scope

**In scope**:
- `src/studio/createInboxBadgeNavbar.tsx` (create) — the
  `createInboxBadgeNavbar(config)` factory and its returned component.
- `src/plugin.tsx` — register the new `navbar` override alongside
  `activeToolLayout` and `layout`.
- `README.md` — one sentence, next to Step 5's "Reading the open count
  without the pane" section from Plan 016, noting the badge is built on top
  of it and is on by default (or documenting the opt-out — see Step 2's
  design decision).
- `src/studio/createInboxBadgeNavbar.test.tsx` (create) — whatever is
  actually unit-testable (see Step 3 for the honest scope of this, same
  caveat Plan 016's Step 6 names).

**Out of scope**:
- `src/studio/inboxCountLayout.tsx` — this plan consumes
  `useInboxOpenCount()`, it does not modify how it is computed.
- Precise pixel-perfect placement inside Sanity's own navbar DOM (e.g.
  finding the exact logo/workspace-switcher slot to render into instead of
  a viewport-fixed position) — Plan 011's Findings flagged this as an open
  visual-polish question or a materially different implementation, and it
  is deliberately not solved here (see Maintenance notes). This plan ships
  the spike's already-proven, functionally-correct `position: fixed`
  approach and does not chase pixel-perfect integration.
- `toolMenu` as an alternative, more narrowly-scoped composition point
  (real, per Plan 011's Findings, but untried) — a follow-up idea, not this
  plan.

## Git workflow

- Branch: `advisor/017-nav-badge-production`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period: e.g. `feat: add a live badge to the Studio navbar`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |
| Dev       | `npm run dev`          | serves at `http://localhost:3333` — manual verification is load-bearing, see Step 4 |

## Steps

### Step 1: Build the badge component

Create `src/studio/createInboxBadgeNavbar.tsx`:

```tsx
import {Badge} from '@sanity/ui'
import {Fragment} from 'react'
import {type NavbarProps} from 'sanity'

import {useInboxOpenCount} from './inboxCountLayout'

/**
 * Builds the `studio.components.navbar` override that shows a live "N things
 * waiting" badge — the same number the Inbox pane's own headline shows, via
 * `useInboxOpenCount()` (Plan 016), visible from anywhere in the Studio.
 *
 * `position: fixed` on the badge itself, not a wrapping positioned `Box`
 * around `renderDefault(props)` — see `plans/017-nav-badge-production.md`
 * for why the more obvious wrapping approach silently fails to paint at all
 * (Studio's own navbar establishes a stacking context the wrapper cannot
 * escape). This composes with any other plugin's own navbar override
 * automatically, the same way `createActiveToolLayout` already does for
 * `activeToolLayout` — see `test-studio/plugins/activeToolLayoutProbe.tsx`
 * for the proof this repo already carries of that composition working with
 * two overrides stacked.
 */
export function createInboxBadgeNavbar() {
  return function InboxBadgeNavbar(props: NavbarProps) {
    const count = useInboxOpenCount()

    return (
      <Fragment>
        {props.renderDefault(props)}
        {count !== null && count > 0 && (
          <div
            aria-label={`${count} things waiting on you`}
            role="status"
            style={{position: 'fixed', top: 6, left: 6, zIndex: 2147483647, pointerEvents: 'none'}}
          >
            <Badge fontSize={0} radius={6} tone="critical">
              {count}
            </Badge>
          </div>
        )}
      </Fragment>
    )
  }
}
```

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Register it in `plugin.tsx`

```tsx
import {createInboxBadgeNavbar} from './studio/createInboxBadgeNavbar'
```

```tsx
studio: {
  components: {
    activeToolLayout: createActiveToolLayout(config),
    layout: createInboxCountLayout(config),
    navbar: createInboxBadgeNavbar(),
  },
},
```

No config options are added for this — the badge is on whenever
`structureInbox()` is registered, matching how `activeToolLayout`'s redirect
behavior defaults on rather than requiring opt-in. If a future consumer
wants to turn it off, that is a real, reasonable ask, but it is a new
`StructureInboxConfig` option (e.g. `navbarBadge?: boolean`) — a small
follow-up, deliberately not built speculatively here (see STOP conditions:
do not add this option unless you find a concrete reason it's needed to
finish this plan).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Tests

Same honest scope as Plan 016's Step 6 — `createInboxBadgeNavbar`'s
component depends on `useInboxOpenCount()`, which depends on context set up
by `createInboxCountLayout`, which depends on `useDismissals`/`useSnoozes`,
which need a full Studio client context to mount for real. Create
`src/studio/createInboxBadgeNavbar.test.tsx` covering only what does not
require that:

1. **Renders nothing extra when `useInboxOpenCount()` returns `null` or
   `0`** — mock `./inboxCountLayout`'s `useInboxOpenCount` (via `vi.mock`,
   the same pattern `useDismissals.test.tsx` uses for `useClient`) to return
   `null`, then `0`; in both cases, render the component with a stub
   `renderDefault` and confirm only the stub's own output appears, no
   badge.
2. **Renders the badge with the right count and an accessible label** when
   `useInboxOpenCount()` is mocked to return a positive number.
3. **Always calls `renderDefault`** — regardless of the count, confirm the
   stub `renderDefault` was invoked exactly once (the composition guarantee
   this whole plan's "Why this matters" section rests on).

**Verify**: `npm test -- createInboxBadgeNavbar` → all pass.

### Step 4: Manual verification in `test-studio` (load-bearing)

1. `npm run build && npm run dev`, open the `default` workspace.
2. Confirm the badge is not visible with a clean/empty inbox.
3. Create or leave an item open (e.g. an old draft, matching the existing
   manual-verification fixtures already in this dataset) so the count is
   positive; confirm the badge appears with the right number, in the
   top-left of the viewport.
4. Mark that item done from inside the Inbox pane; confirm the badge's
   number decreases immediately (this is Plan 016's own core guarantee,
   surfaced here) or the badge disappears entirely once the count reaches 0.
5. Switch to a different tool (e.g. Vision) so the Inbox pane unmounts;
   confirm the badge is still visible and still correct — this is the
   actual point of the feature.

**Verify**: describe what you observed in your final report — manual check,
no automated command, not optional.

### Step 5: README

Add one sentence near Plan 016's "Reading the open count without the pane"
section: this number is also shown, live, as a small badge on the Studio's
own navbar by default whenever `structureInbox()` is registered.

**Verify**: manually re-read for sense.

### Step 6: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- New file: `src/studio/createInboxBadgeNavbar.test.tsx`, the 3 cases in
  Step 3.
- Step 4's manual verification is the real proof this plan works end to
  end and is not optional.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including `createInboxBadgeNavbar.test.tsx`'s 3
  new cases
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "navbar: createInboxBadgeNavbar" src/plugin.tsx` finds the
  new registration
- [ ] Step 4's manual verification performed and its result reported
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 016 is not DONE yet, or `useInboxOpenCount()`'s actual exported
  signature differs from `(): number | null` — this plan is built directly
  on top of it.
- You find yourself wanting to add a `StructureInboxConfig` option (an
  opt-out, a custom position, a custom color) to make this plan's own steps
  pass — that is scope creep past what Step 2 already decided; if a done
  criterion genuinely cannot be met without one, stop and report which one
  and why, rather than adding config surface unilaterally.
- The manual check in Step 4 shows the badge failing to appear at all, even
  with the exact `position: fixed`/`Fragment` shape quoted in "Current
  state" — that would mean something about Studio's navbar rendering has
  changed since Plan 011's spike; do not chase increasingly exotic CSS
  fixes, stop and report what you observed.

## Maintenance notes

- The badge's fixed screen position (top-left, `zIndex: 2147483647`) is a
  known, deliberately-not-perfect placement — it is not anchored to
  Sanity's own logo/workspace-switcher DOM node, because no such stable
  integration point was confirmed during Plan 011's investigation. A future
  visual-polish pass could pursue rendering into that actual slot instead,
  once/if such a slot is confirmed to exist and be stable across Sanity
  versions; treat the current fixed position as correct-but-crude, not as a
  bug to silently "fix" by guessing at a DOM selector.
- If a later plan adds a `StructureInboxConfig` option to control this
  badge (position, on/off, color), it should default to today's always-on
  behavior — this plan does not add a way to turn it off, and a
  maintainer's first request for one should get an explicit, reviewed
  option rather than an implicit behavior change.
