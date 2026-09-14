# Plan 016: Let the open count escape the pane (`useInboxOpenCount`)

> **Executor instructions**: This is a real refactor with a real correctness
> trap in it — read "Why this matters" and "The design constraint that
> shapes everything" in full before writing any code; they explain *why*
> the obvious-looking shortcut is wrong, not just what to build instead.
> Follow the steps in order. Every step ends in a verification command — run
> it before moving on. If a STOP condition fires, stop and report rather
> than improvising. When done, update this plan's status row in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d2cc473..HEAD -- src/inbox/Inbox.tsx src/inbox/SourceFeed.tsx src/store/useDismissals.ts src/store/useSnoozes.ts src/types.ts src/plugin.tsx src/studio/createActiveToolLayout.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MEDIUM (touches `Inbox.tsx`'s state ownership — the pane's own
  most integration-heavy component — though the change to it is small and
  mechanical; see "Current state" for exactly what moves)
- **Depends on**: none
- **Category**: direction (implements "Direction A" from
  `plans/README.md`'s 2026-09-09 batch, and is the prerequisite Plan
  011's own Findings identified for a production nav badge — Plan 017,
  written alongside this one, depends on this plan)
- **Planned at**: commit `d2cc473`, 2026-09-14

## Why this matters

`Inbox.tsx` already computes a live "how many things are open" count
(`openCount`) for its own headline — but only while the Inbox pane itself is
mounted. `plans/README.md`'s "Direction A" named the gap directly: *"`Inbox.tsx`
already hand-rolls an `onCount` callback to lift the total out of each
section — exporting `useInboxCount(sources)` would let a navbar or dashboard
widget show '3 waiting' without rendering the pane."* Plan 011's nav-badge
spike confirmed this is wanted and technically reachable (a live badge on
the Structure tool's own navbar, demonstrated end-to-end against a real
Studio) — but its own Findings explicitly flagged that the count itself
needs this exact plan done first:

> A production plan should register one provider component [at
> `studio.components.layout`] that runs each source's `useItems()` exactly
> once and exposes `openCount` ... via context; `Inbox.tsx` would then read
> from that context instead of maintaining its own `reports` state ... — a
> real, non-trivial refactor ... not a small addition.

## The design constraint that shapes everything

The obvious-looking shortcut — mount a second, independent, always-present
provider that calls its own `useDismissals()`/`useSnoozes()` and its own copy
of each main source's `SourceFeed`, leaving `Inbox.tsx` completely untouched
— is **wrong**, not just wasteful. `useDismissals`/`useSnoozes` each load
their document **once** on mount and then hold **local, optimistic** state;
neither one polls or re-fetches afterward (see `src/store/useDismissals.ts`'s
own comments on `dirtyRef`/`hasLocalEditRef` — the whole design assumes
exactly one long-lived instance owns the truth for a given session). Two
independent instances of `useDismissals` mounted at once — one inside the
pane, one in an always-present provider — each keep their **own** copy of
what's dismissed. The moment an editor dismisses something through the pane,
the provider's separate copy has no way to find out: it never refetches, and
nothing calls *its* `dismiss()`. Its `openCount` — the exact number this plan
exists to expose — would silently go stale for the rest of the session,
which is worse than not having the feature: a badge that keeps counting an
item the editor just cleared is actively misleading.

The fix is not to avoid the second live subscription — a `SourceFeed` per
source is comparatively cheap and safe to run twice — it is to make sure
there is only ever **one** `useDismissals`/`useSnoozes` instance, shared. The
always-present provider becomes the one true owner of both; `Inbox.tsx`
stops calling `useDismissals()`/`useSnoozes()` itself and reads the same two
objects back out of context instead. Everything else about `Inbox.tsx` — its
own `reports` state, its own `BoundedSourceFeed` mounts, `MergedList`,
`InboxSection` — is **unchanged**. This plan does not eliminate the
duplicated `SourceFeed` subscriptions themselves (the provider needs its own
main-source feeds to compute a count while the pane isn't mounted at all) —
only the one piece of state (dismissals/snoozes) where duplication is a real
bug rather than an efficiency question. That tradeoff is deliberate and
documented in Scope/Maintenance notes below, not an oversight.

## Current state

**`src/inbox/Inbox.tsx:151-158`** — exactly what moves (the only two lines
that stop being called directly):

```tsx
export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const neverExpireDismissalSources = useMemo(
    () => sources.filter((source) => source.neverExpireDismissals).map((source) => source.name),
    [sources],
  )
  const dismissals = useDismissals(neverExpireDismissalSources)
  const snoozes = useSnoozes()
```

Everything below this in `Inbox.tsx` — `view` state, the `now` ticker, the
`reports` state and `handleReport`, `asideVisibleCounts`, `main`/`aside`
filtering, `mainOrder`, `openCount`, the whole JSX tree including every
`BoundedSourceFeed`/`BoundedSection`/`MergedList` — **stays exactly as
written**. Only the two lines above change, from calling the hooks directly
to reading their result from a new context.

**`src/inbox/Inbox.tsx:1-26`** (imports, for the two that get added/adjusted):

```tsx
import {
  Box, Card, Container, Flex, Grid, Heading, Stack, Tab, TabList, TabPanel, Text,
} from '@sanity/ui'
import {type ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useDismissals} from '../store/useDismissals'
import {useSnoozes} from '../store/useSnoozes'
import {SectionCard} from '../ui/SectionCard'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'
import {StatusDot} from '../ui/StatusDot'
import {InboxSection} from './InboxSection'
import {MergedList} from './MergedList'
import {SourceFeed, type SourceReport} from './SourceFeed'
import {type InboxSource, type InboxView} from './types'
```

**`src/inbox/SourceFeed.tsx`** (whole file, 92 lines, unchanged by this plan
— quoted because the new provider mounts this same component directly,
reusing it rather than reimplementing it):

```tsx
export interface SourceReport extends Omit<InboxSourceResult, 'items' | 'loading'> {
  source: InboxSource
  loading?: boolean
  open: InboxItem[]
  done: InboxItem[]
  snoozed: InboxItem[]
}

export function SourceFeed(props: SourceFeedProps) {
  const {source, dismissals, snoozes, now, onReport} = props
  const {items, loading, error, resolve, create, assess, assign, remove, update} = source.useItems()

  const {open, done, snoozed} = useMemo(
    () => splitItems(items, source.name, dismissals.state, snoozes.state, now),
    [items, source.name, dismissals.state, snoozes.state, now],
  )
  // ... capability-fingerprint effect, then:
  useEffect(() => {
    onReport(source.name, {source, loading, error, open, done, snoozed, ...capabilities.current})
  }, [/* ... */])

  return null
}
```

**`src/inbox/Inbox.tsx:128-149`** — `BoundedSourceFeed`, already exported,
already the exact "one main source, contained" wrapper this plan's new
provider reuses as-is (no changes to this component either):

```tsx
export function BoundedSourceFeed(props: BoundedSourceFeedProps) {
  const {source, dismissals, snoozes, now, onReport} = props

  const handleCatch = useCallback(
    (error: Error) => {
      onReport(source.name, {source, error, open: [], done: [], snoozed: []})
    },
    [source, onReport],
  )

  return (
    <SectionErrorBoundary fallback={null} onCatch={handleCatch}>
      <SourceFeed dismissals={dismissals} now={now} onReport={onReport} snoozes={snoozes} source={source} />
    </SectionErrorBoundary>
  )
}
```

**`src/studio/createActiveToolLayout.tsx`** (whole file, 67 lines — the
sibling pattern this plan's new `studio.components.layout` override must
match, both in shape and in the fact that it also ends by calling
`props.renderDefault(props)`):

```tsx
export function createActiveToolLayout(config: ResolvedStructureInboxConfig) {
  return function StructureInboxActiveToolLayout(props: ActiveToolLayoutProps) {
    // ... hooks ...
    return props.renderDefault(props)
  }
}
```

**`src/plugin.tsx`** (whole file, 73 lines — where the new layout override
gets registered, alongside the existing `activeToolLayout` one):

```tsx
export const structureInbox = definePlugin<StructureInboxConfig | void>((options) => {
  const config = resolveConfig(options || undefined)

  return {
    name: PLUGIN_NAME,
    studio: {
      components: {
        activeToolLayout: createActiveToolLayout(config),
      },
    },
    tools: (prev) => { /* ... unchanged ... */ },
    i18n: { bundles: structureInboxLocaleBundles },
  }
})
```

**`src/types.ts:50-54`** — `ResolvedStructureInboxConfig`, already carrying
`sources: InboxSource[]` (required, defaults to `[]` in `resolveConfig.ts`),
which is all the new provider needs to know which sources to subscribe to:

```ts
export type ResolvedStructureInboxConfig = Required<
  Pick<StructureInboxConfig, 'toolName' | 'showInList' | 'redirectOnLanding' | 'sources'>
> &
  Pick<StructureInboxConfig, 'title'>
```

**`src/index.ts`** (current export list, for where the new public hook
joins — its own new export line, not grouped with the existing "pure,
dependency-free" block, since this one is a React hook, not a pure function):

```ts
export {DEFAULT_TOOL_NAME, INBOX_PANE_ID, STRUCTURE_INBOX_NAMESPACE} from './constants'
export {structureInbox} from './plugin'
export {inboxListItem} from './structure/inboxNode'
export type {StructureInboxConfig} from './types'

export type {InboxItem, InboxSource, InboxSourceResult} from './inbox/types'
// ... source factories ...

export {SectionCard} from './ui/SectionCard'

// Pure, dependency-free reads ...
export {isDismissed, parseDismissals, type DismissalState} from './store/dismissals'
export {isSnoozed, parseSnoozes, type SnoozeState} from './store/snoozes'
export {parseTodos, type TodoItem, type TodosState} from './store/todos'
export {buildDigest, type DigestEditor, type DigestSource, type EditorDigest} from './digest'
export {EDITOR_DOC_TYPES, findStaleEditorDocuments, type EditorDocRef} from './staleEditorDocs'
```

**Repo conventions to match**:

- A `studio.components.*` override is built by a `create<Slot>(config)`
  factory returning the actual component — see `createActiveToolLayout`
  above, in its own file under `src/studio/`.
- A component that must compose with Sanity's own default rendering calls
  `props.renderDefault(props)` — never replaces it outright — see the same
  file.
- `Inbox.tsx`'s own components (`BoundedSection`, `BoundedSourceFeed`) are
  exported specifically so other code (today, tests; after this plan, the
  new provider too) can reuse them without re-deriving the same
  boundary/reporting wiring.

## Scope

**In scope**:
- `src/studio/inboxCountLayout.tsx` (create) — the new
  `createInboxCountLayout(config)` factory: the `studio.components.layout`
  override, an internal (not publicly exported) context carrying
  `{dismissals, snoozes}`, and the public `useInboxOpenCount()` hook.
- `src/plugin.tsx` — register the new layout override alongside
  `activeToolLayout`.
- `src/inbox/Inbox.tsx` — replace the two hook calls at lines 153-158 with a
  read from the new internal context. No other line in this file changes.
- `src/index.ts` — export `useInboxOpenCount`.
- `README.md` — document the new hook (see Step 5).
- `src/studio/inboxCountLayout.test.ts(x)` (create) — unit tests for
  whatever part of this is unit-testable without a full Studio (see Step 6
  for what that is and, honestly, what it is not).

**Out of scope**:
- Eliminating the duplicated `SourceFeed`/`source.useItems()` subscriptions
  themselves — accepted, documented tradeoff (see "The design constraint
  that shapes everything" above). A future plan could pursue this (e.g. by
  also lifting the *reports* into the shared context and having `Inbox.tsx`
  consume rather than re-fetch them) only if this duplication turns out to
  matter in practice; do not attempt it here.
- Building the actual nav badge UI — that is Plan 017, written alongside
  this plan and depending on it. This plan only produces
  `useInboxOpenCount()`; nothing in this plan renders a badge anywhere.
- `src/inbox/SourceFeed.tsx`, `src/inbox/InboxSection.tsx`,
  `src/inbox/MergedList.tsx` — none of these change. The provider reuses
  `SourceFeed`/`BoundedSourceFeed` as already-exported, unmodified
  components.
- Any change to `InboxSource`, `InboxSourceResult`, or any built-in source —
  this plan only touches state *ownership*, not the source contract.

## Git workflow

- Branch: `advisor/016-inbox-open-count-provider`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period: e.g. `feat: share dismissals/snoozes between the
  pane and a new always-mounted count provider`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |
| Dev       | `npm run dev`          | serves at `http://localhost:3333` (see Step 7 — manual verification is load-bearing for this plan) |

## Steps

### Step 1: Write the internal shared-store context and the provider component

Create `src/studio/inboxCountLayout.tsx`:

```tsx
import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'
import {type LayoutProps} from 'sanity'

import {BoundedSourceFeed} from '../inbox/Inbox'
import {type SourceReport} from '../inbox/SourceFeed'
import {useDismissals, type Dismissals} from '../store/useDismissals'
import {useSnoozes, type Snoozes} from '../store/useSnoozes'
import {type ResolvedStructureInboxConfig} from '../types'

interface SharedInboxStore {
  dismissals: Dismissals
  snoozes: Snoozes
}

/**
 * Not exported from `src/index.ts` — this is the plumbing that lets
 * `Inbox.tsx` and this plan's always-mounted provider share one
 * `useDismissals`/`useSnoozes` instance instead of two independent ones. See
 * this plan's "The design constraint that shapes everything" for why two
 * independent instances would silently drift apart. `Inbox.tsx` is only ever
 * reached through the `structure` resolver `structureInbox()` itself wraps
 * (`src/plugin.tsx`), and this provider is unconditionally registered by
 * that same plugin, so `Inbox.tsx` can assume this context is always present
 * — there is no supported way to reach `Inbox.tsx` without it.
 */
const SharedInboxStoreContext = createContext<SharedInboxStore | null>(null)

/** Read by `Inbox.tsx` instead of calling `useDismissals`/`useSnoozes` itself. */
export function useSharedInboxStore(): SharedInboxStore {
  const store = useContext(SharedInboxStoreContext)
  if (!store) {
    throw new Error(
      '[sanity-plugin-structure-inbox] Inbox rendered without its layout provider. ' +
        'This should not be reachable outside structureInbox() itself.',
    )
  }
  return store
}

const InboxOpenCountContext = createContext<number | null>(null)

/**
 * How many things are open across every configured `main` source, live —
 * the same number the Inbox pane's own headline shows, available without
 * mounting the pane. `null` until this plugin's layout provider (wired
 * automatically by `structureInbox()`) has reported at least once.
 *
 * @public
 */
export function useInboxOpenCount(): number | null {
  return useContext(InboxOpenCountContext)
}

/**
 * Builds the `studio.components.layout` override that owns the one shared
 * `useDismissals`/`useSnoozes` instance (see `useSharedInboxStore`) and
 * exposes a live open count via `useInboxOpenCount()` — both available for
 * the whole time the Studio is open, not only while the Inbox pane is.
 */
export function createInboxCountLayout(config: ResolvedStructureInboxConfig) {
  const mainSources = config.sources.filter((source) => (source.placement ?? 'main') === 'main')
  const neverExpireDismissalSources = mainSources
    .filter((source) => source.neverExpireDismissals)
    .map((source) => source.name)

  return function InboxCountLayout(props: LayoutProps) {
    const dismissals = useDismissals(neverExpireDismissalSources)
    const snoozes = useSnoozes()

    // Same 60s tick `Inbox.tsx` uses for its own open/snoozed split — see
    // that file's identical comment for why: a snoozed item needs to wake on
    // its own without user interaction to prompt a re-render.
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 60_000)
      return () => clearInterval(id)
    }, [])

    const [reports, setReports] = useState<Record<string, SourceReport>>({})
    const handleReport = useCallback((sourceName: string, report: SourceReport) => {
      setReports((current) => ({...current, [sourceName]: report}))
    }, [])

    const openCount = useMemo(
      () =>
        mainSources.reduce((total, source) => total + (reports[source.name]?.open.length ?? 0), 0),
      [reports],
    )

    const store = useMemo<SharedInboxStore>(() => ({dismissals, snoozes}), [dismissals, snoozes])

    return (
      <SharedInboxStoreContext.Provider value={store}>
        <InboxOpenCountContext.Provider value={openCount}>
          {mainSources.map((source) => (
            <BoundedSourceFeed
              dismissals={dismissals}
              key={source.name}
              now={now}
              onReport={handleReport}
              snoozes={snoozes}
              source={source}
            />
          ))}
          {props.renderDefault(props)}
        </InboxOpenCountContext.Provider>
      </SharedInboxStoreContext.Provider>
    )
  }
}
```

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Register the new layout override in `plugin.tsx`

```tsx
import {createInboxCountLayout} from './studio/inboxCountLayout'
```

```tsx
studio: {
  components: {
    activeToolLayout: createActiveToolLayout(config),
    layout: createInboxCountLayout(config),
  },
},
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Refactor `Inbox.tsx` to read the shared store instead of owning it

Replace lines 153-158 (the two hook calls) with:

```tsx
export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const {dismissals, snoozes} = useSharedInboxStore()
```

Remove the now-unused `neverExpireDismissalSources` computation (that logic
moved into `createInboxCountLayout`'s module scope in Step 1 — it's computed
once there, not per-render in `Inbox.tsx` anymore). Remove the now-unused
`useDismissals`/`useSnoozes` imports; add
`import {useSharedInboxStore} from '../studio/inboxCountLayout'`.

Nothing else in `Inbox.tsx` changes — `dismissals`/`snoozes` are used
exactly the same way by every line below this that already references them.

**Verify**: `npm run typecheck` → exit 0. Then `npm test -- Inbox` — the
existing `BoundedSection`/`BoundedSourceFeed` tests must still pass
unmodified (they render those two components directly with hand-built
`Dismissals`/`Snoozes` fakes, never through `<Inbox>` itself, so this
refactor should not affect them at all — if it does, that is a signal
something about this step went wrong).

### Step 4: Export the public hook

In `src/index.ts`, add (its own line, not grouped with the pure-function
block — it is a React hook and belongs with `structureInbox` itself near
the top of the file):

```ts
export {useInboxOpenCount} from './studio/inboxCountLayout'
```

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Document it in the README

Add a short new subsection, immediately after "Live updates"
(`README.md:152-165` in the current file — re-locate it if it has moved) or
wherever the "how do I get a total elsewhere" question best fits alongside
the existing sources/audience documentation:

```md
### Reading the open count without the pane

`useInboxOpenCount()` returns the same live "how many things are open"
number the pane's own headline shows — usable anywhere in the Studio, not
only while the Inbox pane itself is mounted (a custom navbar badge, say).
Returns `null` until it has reported at least once.

​```tsx
import {useInboxOpenCount} from 'sanity-plugin-structure-inbox'

function MyBadge() {
  const count = useInboxOpenCount()
  return count ? <Badge>{count}</Badge> : null
}
​```
```

**Verify**: manually re-read for sense; confirm the export named actually
exists in `src/index.ts` after Step 4.

### Step 6: Tests

Be honest about what is and is not unit-testable here. `createInboxCountLayout`'s
returned component calls `useDismissals`/`useSnoozes`, which call
`useClient`/`useCurrentUser` — the same reason `Inbox.tsx` itself has no
direct render test today (see `Inbox.test.tsx`'s own comment: *"`Inbox`
itself calls `useDismissals`, which calls `useClient` and needs a full
Studio source context"*). Follow that file's existing precedent rather than
fighting it:

Create `src/studio/inboxCountLayout.test.tsx`, mocking `useDismissals`/
`useSnoozes`/`useClient`/`useCurrentUser` the same way
`useDismissals.test.tsx` or `Inbox.test.tsx` already do (read both first).
Cover:

1. **`useInboxOpenCount()` returns `null` before any source has reported.**
2. **`useInboxOpenCount()` sums only `main`-placement sources' open counts**
   — construct two fake sources, one `placement: 'aside'`, and confirm the
   aside one's items are not counted (mirrors `Inbox.tsx`'s own existing
   `mainOrder`/`openCount` rule — this plan must preserve it exactly).
3. **`useSharedInboxStore()` throws when called outside the provider** — a
   direct `renderHook(() => useSharedInboxStore())` with no wrapping
   provider should throw the error message from Step 1.

If mocking `useClient`/`useCurrentUser` to get `createInboxCountLayout`'s
component rendering at all proves more invasive than these three cases are
worth, STOP and report rather than forcing it — this is a real, known gap
(matching `Inbox.tsx`'s own, already-accepted gap) and Step 7's manual
verification is what actually proves this plan works end to end.

**Verify**: `npm test -- inboxCountLayout` → all pass.

### Step 7: Manual verification in `test-studio` (load-bearing — do not skip)

This plan's core correctness claim — that dismissing something in the pane
is immediately reflected in `useInboxOpenCount()`, with no drift — is not
covered by an automated test (Step 6 explicitly does not attempt to mount
the full provider against a real dataset). Verify it by hand:

1. `npm run build && npm run dev`, open the `default` workspace.
2. Temporarily add one `<Text>{useInboxOpenCount()}</Text>` somewhere
   visible in `test-studio` (anywhere simple — e.g. inside the existing
   `activeToolLayoutProbe.tsx` probe banner, or a one-off addition to
   `test-studio/sanity.config.ts`'s structure) so the number is visible
   without a real badge yet (Plan 017 builds the real one).
3. Open the Inbox pane, note the displayed number matches the pane's own
   headline count.
4. Mark one open item done. Confirm the on-screen `useInboxOpenCount()`
   value decrements **immediately**, in the same render, not after a reload
   — this is the exact staleness bug this plan's design avoids; if it does
   not update immediately, something regressed to the two-independent-instances
   shape this plan exists to prevent.
5. Remove the temporary `<Text>` addition before finishing — it is scratch
   verification, not a permanent change to `test-studio`.

**Verify**: describe what you observed in this plan's own commit message or
a short note in your final report — this is a manual check with no
automated command, but it is not optional.

### Step 8: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- New file: `src/studio/inboxCountLayout.test.tsx`, the 3 cases in Step 6.
- Existing `src/inbox/Inbox.test.tsx` must continue passing unmodified — it
  is the regression signal that `BoundedSection`/`BoundedSourceFeed` (reused
  as-is by the new provider) still behave exactly as before.
- Step 7's manual verification is the real end-to-end proof for this plan's
  core claim and cannot be skipped in favor of the unit tests alone.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including `inboxCountLayout.test.tsx`'s 3 new
  cases and every existing `Inbox.test.tsx` case unmodified
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "useInboxOpenCount" src/index.ts` finds the new export
- [ ] `grep -n "layout: createInboxCountLayout" src/plugin.tsx` finds the
  new registration
- [ ] Step 7's manual verification performed and its result reported (the
  count updates immediately on a dismiss, no reload needed)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `Inbox.tsx` turns out to be reachable from anywhere other than the
  `structure` resolver `structureInbox()` itself wraps (i.e. some other code
  path renders `<Inbox>` directly) — `useSharedInboxStore`'s "always present"
  assumption depends on this not being true; if it is, the throw in Step 1
  would break that other path and the design needs to change (a fallback, or
  a different composition point) rather than being special-cased away.
- `useDismissals`/`useSnoozes`'s signatures or internal
  fetch/persist/merge shape have changed from what "The design constraint
  that shapes everything" describes — that section's whole argument rests
  on them being one-shot-fetch-then-local-state, no polling.
- Step 6's tests genuinely cannot be written without mocking so much of
  `sanity`/`react` that they stop meaningfully testing anything — report
  which cases were skipped and why, rather than writing a test that passes
  without asserting anything real.
- Step 7's manual check shows the count does *not* update immediately after
  a dismiss — that means the shared-store design has a bug; do not ship
  Step 8's sweep as green if this is the case, stop and report the
  discrepancy instead.

## Maintenance notes

- The duplicated `SourceFeed` subscriptions (provider + pane, both running
  when the pane is open) are a known, accepted cost of this design — flagged
  in Scope. If this ever shows up as a real performance problem (excess
  `client.listen` connections, say), the fix is to also lift `reports` into
  the shared context and have `Inbox.tsx` consume rather than re-fetch them
  — a bigger, separate plan, not a tweak to this one.
- Any future code that wants the *rest* of what a source reports (not just
  the open count — e.g. a full per-source breakdown) should extend
  `InboxOpenCountContext`'s payload rather than adding a third independent
  subscription; the whole point of this plan is that there should only ever
  be one live-and-shared copy of this state.
- `useSharedInboxStore` is deliberately internal (not exported from
  `src/index.ts`) — it is plumbing between this plugin's own two integration
  points, not a documented extension point for consumers. Do not export it
  in a later plan without deciding what its public contract would even mean
  for someone outside this codebase.
