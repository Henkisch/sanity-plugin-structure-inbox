# Plan 011: Investigate a live badge on the Structure tool's own nav icon

> **Executor instructions**: This is an **investigation/spike plan**, not a
> build-everything plan. Follow it step by step. The deliverable is a working
> proof-of-concept in `test-studio` plus a written answer to each open
> question — not production wiring into `src/plugin.tsx`. If anything in the
> "STOP conditions" section occurs, stop and report — do not improvise past
> it. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2218e06..HEAD -- src/plugin.tsx src/inbox/Inbox.tsx src/inbox/MergedList.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (for the spike itself; a production version is a separate,
  later plan once this one answers the open questions)
- **Risk**: LOW (test-studio only; nothing in `src/` is required to change)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2218e06`, 2026-09-13

## Why this matters

`README.md:283-285` and `:311-318` describe two live signals this plugin
already tracks but never surfaces outside its own pane: a snoozed item waking
up, and a dismissal expiring because the underlying document changed. Both
rely on realtime plumbing that already exists — `src/inbox/sources/liveQuery.ts`
wraps `client.listen` so a source's items update without a manual refresh, and
`Inbox.tsx` already computes a live "how many things are open" count for its
own headline. None of that becomes visible unless an editor has the Inbox
pane open right now. A small badge on the Structure tool's own icon — the one
this plugin already reaches into via `tools: (prev) => ...` in
`src/plugin.tsx` — would make "something new showed up" visible from
anywhere else in the Studio, the same way an unread-mail badge works.

This plan exists because **the mechanism is genuinely unconfirmed**. Grepping
this repo's installed `sanity` package types during recon turned up real
component-override surfaces this plugin has never touched
(`studio.components.navbar`, and a distinct `ToolMenuProps` type suggesting a
`toolMenu` slot too) — but their exact shape wasn't pinned down from the
type re-exports alone (`sanity`'s `.d.ts` files are heavily bundled/aliased
and don't grep cleanly; the executor's own editor/tsserver, with
go-to-definition, will resolve this far faster than grep). Don't build
production wiring on an unconfirmed API — confirm it first, cheaply, in
`test-studio`.

## Current state

**`src/plugin.tsx`** (the whole file, 73 lines) — this is where any real
integration would eventually live; it already has a `studio.components`
override (`activeToolLayout`) and already walks `tools: (prev) => ...` to
find and modify this plugin's own tool entry:

```tsx
// src/plugin.tsx
import {definePlugin, type Tool} from 'sanity'
import {type StructureToolOptions} from 'sanity/structure'

import {PLUGIN_NAME} from './constants'
import {structureInboxLocaleBundles} from './i18n'
import {resolveConfig} from './structure/resolveConfig'
import {wrapStructure} from './structure/wrapStructure'
import {createActiveToolLayout} from './studio/createActiveToolLayout'
import {type StructureInboxConfig} from './types'
import {warnOnce} from './warnOnce'

export const structureInbox = definePlugin<StructureInboxConfig | void>((options) => {
  const config = resolveConfig(options || undefined)

  return {
    name: PLUGIN_NAME,

    studio: {
      components: {
        activeToolLayout: createActiveToolLayout(config),
      },
    },

    tools: (prev) => {
      const target = prev.find((tool) => tool.name === config.toolName)

      if (!target) {
        warnOnce(/* ... */)
        return prev
      }

      return prev.map((tool): Tool => {
        if (tool !== target) return tool

        const options: StructureToolOptions | undefined = tool.options

        return {
          ...tool,
          options: {...options, structure: wrapStructure(options?.structure, config)},
        }
      })
    },

    i18n: {
      bundles: structureInboxLocaleBundles,
    },
  }
})
```

**`src/inbox/Inbox.tsx:200-203`** — the existing live "how many things are
open" computation, currently only feeding the pane's own headline:

```tsx
// src/inbox/Inbox.tsx:200-203
const openCount = useMemo(
  () => mainOrder.reduce((total, name) => total + (reports[name]?.open.length ?? 0), 0),
  [reports, mainOrder],
)
```

This number only exists because `Inbox.tsx` is mounted and its
`BoundedSourceFeed`/`SourceFeed` children (`src/inbox/SourceFeed.tsx`) are
running each source's live `useItems()` query. **A nav badge needs this same
number available when the Inbox pane is *not* mounted** — which is the crux
of what this spike must resolve (see Open Questions).

**`test-studio/sanity.config.ts`** — the workspace registry this plugin's own
manual-verification workspaces already live in (`default`, `noList`, `multi`,
`asyncDelayed` — see `README.md`'s "Develop & test" table). Add a new
workspace here for this spike rather than modifying `default`.

**Repo conventions to match**:

- Every structural/studio-integration technique this plugin uses gets a
  paragraph in `README.md`'s "How it works" section explaining *why*, not
  just *what* — see `README.md:373-395`. Any production version of this
  eventually needs the same treatment.
- `warnOnce` (`src/warnOnce.ts`) is the established pattern for "this
  environment doesn't support what we're trying to do — degrade instead of
  throwing." If the chosen mechanism can fail in some Studio configurations
  (e.g. a Studio that already overrides `studio.components.navbar` itself),
  match that pattern rather than crashing.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Dev       | `npm run dev`         | serves at `http://localhost:3333` |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |

`npm run dev` runs the `test-studio` workspace; it consumes this package's
`dist/`, not `src/`, per `README.md:427-429` — **run `npm run build` (or
`npm run link-watch` in a second terminal) after every source change, or the
Studio will keep serving stale code.** This tripped up manual verification
earlier in this project's history; don't skip it.

## Scope

**In scope**:
- `test-studio/sanity.config.ts` — add one new workspace for this spike
  (e.g. `badgeSpike`, `basePath: '/badge-spike'`), following the existing
  pattern of the other four workspaces there.
- A new, throwaway prototype component/plugin, wherever this plan's Step 2
  investigation concludes it needs to live for the chosen mechanism —
  document the location and mechanism chosen in this plan's own "Findings"
  section (add one) rather than in a separate file.
- `plans/README.md` — status row.

**Out of scope**:
- `src/plugin.tsx`, `src/inbox/Inbox.tsx` — do not wire this into the real
  plugin yet. If the spike succeeds, the production version is a **separate,
  later plan** written once the mechanism is confirmed — don't scope-creep
  this one into it.
- Any change to `structureInbox`'s public options (`StructureInboxConfig`) —
  whether a badge is opt-in/opt-out, and what it's called, is a design
  decision for that later plan.

## Git workflow

- Branch: `advisor/011-investigate-nav-badge`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix: e.g. `spike: prototype a nav badge via studio.components.navbar`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the actual override surface

Using your editor's TypeScript tooling (go-to-definition, hover types — not
grep, which does not resolve this package's bundled `.d.ts` re-exports
usefully), find and read the real type definitions for:

1. `studio.components.navbar` — what props does the override component
   receive? Does it get a `renderDefault()` (or equivalently-named) escape
   hatch to render Sanity's own navbar unchanged and only add to it, the way
   `createActiveToolLayout` presumably relies on Studio rendering its own
   content around `activeToolLayout`'s override? (Read
   `src/studio/createActiveToolLayout.tsx` for the sibling pattern this
   plugin already uses for a different `studio.components` slot.)
2. Whether a `Tool`'s own `icon` field (the type `tools: (prev) => ...` in
   `src/plugin.tsx` already maps over) accepts a **React component**, not
   just a static icon element — if so, that component could read live state
   directly, which would be a much smaller integration than overriding the
   whole navbar.

Write down which of these two is real, and which (if either) supports
`renderDefault`-style composition rather than requiring a full reimplementation.

**Verify**: no command — this step's output is written findings, added as a
"## Findings" section at the bottom of *this* plan file before continuing.

### Step 2: Build the smallest possible proof-of-concept

In the new `test-studio` workspace from Scope, using whichever mechanism
Step 1 confirmed is real:

- Render a static badge (a hardcoded number, no live data yet) next to or on
  the Structure tool's icon.
- Confirm it appears in the running Studio at the new workspace's `basePath`.

**Verify**: `npm run build && npm run dev`, then visually confirm the badge
renders at the new workspace's URL. Screenshot or describe what you see in
this plan's "Findings" section.

### Step 3: Wire it to a live count

Still in the spike workspace only: get *some* live count onto the badge —
it does not need to be the exact same sources/logic `Inbox.tsx` uses yet,
a simplified stand-in (e.g. one source's item count) is enough to prove the
plumbing. Note explicitly in Findings whether the real `openCount` logic
(`Inbox.tsx:200-203`) could be extracted into a shared hook usable both by
`Inbox.tsx` and this new integration point without duplicating each source's
live-query wiring — this is the key architectural question the eventual
production plan depends on.

**Verify**: the badge's number changes when the underlying data changes
(e.g. toggle a document, watch the count update within the `liveQuery$`
debounce window — `src/inbox/sources/liveQuery.ts` debounces 500ms).

## Test plan

This is a spike; no unit tests are expected. If Step 1 confirms a stable,
typed API surface, note in Findings whether a colocated test (mirroring
`src/structure/wrapStructure.test.ts`'s style) would be feasible for the
eventual production plan.

## Done criteria

- [ ] "## Findings" section added to this plan file, answering:
  - Which override mechanism is real (navbar override, tool icon component,
    both, or neither) — with the actual type signature quoted.
  - Whether it supports rendering Sanity's own default UI alongside the
    badge (vs. requiring a full reimplementation).
  - Whether `Inbox.tsx`'s `openCount` logic can be shared without duplicating
    per-source live queries.
  - A clear recommendation: proceed to a production plan, or "not worth it"
    with the reason (e.g. if the only mechanism found requires fully
    reimplementing Sanity's navbar).
- [ ] `npm run typecheck` exits 0
- [ ] The proof-of-concept is visible and demonstrated working in the new
  `test-studio` workspace (described in Findings, since this is a manual/visual
  check, not a machine-checkable one)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The only available mechanism requires fully reimplementing Sanity's own
  navbar (not composing with a `renderDefault`-style escape hatch) — that's a
  materially different, much higher-risk commitment than this spike is
  scoped for. Report the finding; do not attempt the full reimplementation.
- `studio.components.navbar` (or whatever the real slot turns out to be
  named) does not exist in the installed `sanity` version at all.
- You find yourself editing `src/plugin.tsx` or any other file outside the
  in-scope list to make the spike work — that means the spike needs
  `test-studio`-only scaffolding you haven't found yet, not a shortcut
  through the real plugin.

## Maintenance notes

- This plan produces a recommendation, not shipped code. The follow-up
  production plan (not yet written) should be created only after this one's
  Findings are read by whoever owns this project next — it depends entirely
  on which mechanism Step 1 confirms.
- If the recommendation is "not worth it," record that in
  `plans/README.md`'s "Findings considered and rejected" section with the one-line
  reason, so this isn't re-investigated from scratch next `/improve` run.

## Findings

### Step 1 — which override mechanisms are real

Both candidates are real, confirmed by reading the actual `.d.ts` behind
`sanity`'s bundled re-exports (`node_modules/sanity/lib/useVirtualizerScrollInstance-DrjJlJI9.d.ts`
in this repo's installed `sanity@6.13.0`), not by grepping the re-export
barrel (`node_modules/sanity/lib/index-Dnq666Ib.d.ts`), which only aliases
these names (`Lt as NavbarProps`, `Bt as ToolMenuProps`, etc.) and does not
carry the shapes.

**1. `studio.components.navbar`** — real, and composable:

```ts
// :7584
interface NavbarProps {
  renderDefault: (props: NavbarProps) => React.JSX.Element;
  __internal_actions?: NavbarAction[]; // @internal @beta
}

// :7625, the shape a plugin's `studio.components` object actually types as
interface StudioComponentsPluginOptions {
  activeToolLayout?: ComponentType<ActiveToolLayoutProps>;
  layout?: ComponentType<LayoutProps>;
  logo?: ComponentType<LogoProps>;
  navbar?: ComponentType<NavbarProps>;
  toolMenu?: ComponentType<ToolMenuProps>;
}
```

`NavbarProps.renderDefault` is the same escape hatch
`createActiveToolLayout.tsx` already relies on for `activeToolLayout`
(`ActiveToolLayoutProps` at `:7594` has the identical shape) — render
Sanity's own navbar unchanged via `renderDefault(props)` and layer content
around it, rather than reimplementing it. A `toolMenu` slot also exists
(`ToolMenuProps` at `:7601`, with `tools: Tool[]`, `activeToolName`,
`context: 'sidebar' | 'topbar'`, and its own `renderDefault`) — a plausible
alternative home for this, not tried in this spike, but worth knowing about
for the production plan since it's scoped to exactly the tool list rather
than the whole navbar.

**2. `Tool.icon`** — real, and is a bare component slot with no escape hatch:

```ts
// :7734
interface Tool<Options = any> {
  component: ComponentType<{tool: Tool<Options>}>;
  icon?: ComponentType;         // <-- no props, no renderDefault
  name: string;
  options?: Options;
  ...
}
```

`icon?: ComponentType` (React's default type parameter makes this
`ComponentType<{}>`) confirms the plan's hypothesis: it's a real, mountable
component, not a static icon element — it runs its own hooks on every render
regardless of receiving no props, so in principle it can subscribe to live
data with zero prop-threading. There's no `renderDefault`-style composition
here (unlike the three `studio.components` slots above), but none is needed:
the plugin already owns the value it's replacing (`prev`'s `tool.icon`), so
"compose with the original" just means capturing that reference and
rendering it inside the wrapper — no cooperation from Studio required.

### Step 2 & 3 — proof-of-concept, and an important empirical correction

Built both mechanisms side by side in a new `badgeSpike` workspace
(`test-studio/sanity.config.ts`, `basePath: '/badge-spike'`), sharing one
live-count hook (`test-studio/plugins/useSpikeDraftsCount.ts` — a simplified
stand-in for `Inbox.tsx`'s `openCount`: `count(*[_id in path("drafts.**")])`
via `client.fetch` + `client.listen`, no debounce, no snooze/dismiss
filtering, one query instead of a merge across sources):

- `test-studio/plugins/navBadgeSpike.tsx` — wraps the `structure` tool's
  `icon` (mechanism 2).
- `test-studio/plugins/navbarBadgeSpike.tsx` — overrides
  `studio.components.navbar`, calls `renderDefault(props)`, and renders a
  badge (mechanism 1).

Verification used a real running Studio (`npm run build && npm run dev
--port=3399` — a non-default port because another session already had 3333
bound; a fresh throwaway Sanity project, `lab81vuo`, was created via the
Sanity MCP tools solely so this could be logged into and exercised end to
end — **delete this project once this plan is reviewed**, it holds nothing
but two test draft documents), driven visually via `claude-in-chrome`
(screenshots + network-request capture), plus two draft documents created
via the Sanity MCP to move the live count.

**The `Tool.icon` mechanism (navBadgeSpike.tsx) does not work in practice,
even though the type signature is real.** In `badgeSpike` (two tools:
`structure`, `releases`, plenty of horizontal room), Sanity's own topbar
`ToolMenu` renders tool tabs as **plain text, and never invokes `tool.icon`
at all**. Confirmed two ways: (a) the accessibility tree shows only text
labels, no icon or badge elements, for both the visible tab and a
duplicate/collapsed one also present in the DOM; (b) network-request capture
showed **zero** requests for this component's own `count(...)` query while
it was the only badge plugin active — i.e. the wrapped icon component never
even mounted, so its hook never ran. This is a real, non-obvious finding:
the plan's "smaller integration" candidate is only as good as Sanity's own
tool-menu layout choice, which is text-first for the common case (few tools,
desktop width) and evidently reserves icon rendering for some other
condition (narrower viewport, more tools than fit, or a `sidebar`-context
`ToolMenu` — not reproduced here; window/viewport resize via the browser
automation tool did not change the Studio's actual rendering viewport in
this environment, so the icon-mode trigger itself is still unconfirmed, only
its *absence* in the common case is).

**The `studio.components.navbar` mechanism works, end to end, visually
confirmed:**

- Screenshot with one draft document present: a red circular badge reading
  "1", pinned at the workspace-switcher corner of the navbar.
- Created a second draft document via the Sanity MCP (`create_documents`)
  without reloading the page; within the observation window the badge
  updated from "1" to "2" live, driven purely by the `client.listen()`
  subscription triggering a refetch — no manual refresh. (The real
  `unpublishedDrafts` Inbox source, watched side by side, correctly did
  *not* pick up the second draft into its own list — it filters
  `_updatedAt < $before` captured at load time, so a draft created after the
  pane loaded is deliberately excluded; this is the real source behaving
  correctly, not a discrepancy in the spike.)
- Network capture confirms the mechanism mounts unconditionally: the
  `count(...)` query and its paired `listen` request both fire every time
  this plugin is registered, regardless of tool count or viewport — because
  the navbar itself is always rendered, unlike a tool's icon, whose
  rendering is at the mercy of Sanity's own `ToolMenu` layout logic.
- One implementation pitfall worth recording for the production plan: an
  initial version wrapped `renderDefault(props)` and the badge in a
  `<Box style={{position: 'relative'}}>` from `@sanity/ui`, absolutely
  positioning the badge inside it — this **mounted and fetched correctly
  but never painted visibly**, almost certainly because Studio's own navbar
  establishes its own stacking context (likely `position: sticky`/`fixed`
  with its own z-index) that the wrapping `Box` didn't escape. Switching to
  `position: fixed` on the badge itself (pinned to the viewport corner,
  `zIndex: 2147483647`) fixed this immediately. A production version should
  investigate a properly-scoped fix (e.g. rendering into the actual DOM
  node Studio's navbar exposes for its logo/switcher slot) rather than a
  viewport-fixed hack, but the takeaway is: **mounting and data-fetching
  succeeding is not the same as the overlay being visible** — budget for
  this kind of CSS/stacking debugging in the production plan, it is not
  free even once the mechanism is confirmed.

### Can `Inbox.tsx`'s `openCount` be shared without duplicating live queries?

Traced the dependency chain: `openCount` (`Inbox.tsx:200-203`) is a
`useMemo` over `reports`, a piece of local `useState` in `Inbox.tsx`
populated by `handleReport`, which is threaded down as a prop to every
`BoundedSourceFeed` → `SourceFeed` for each `main`-placement source. Each of
those mounts `source.useItems()` — the actual live-query hook — only while
`SourceFeed` itself is mounted, which only happens while `Inbox.tsx` is
mounted, which only happens while the Inbox pane is the active pane in the
Structure tool.

A nav badge, by contrast, needs to be live while **any** tool is active, or
even while the Structure tool isn't the active tool at all — i.e. while
`Inbox.tsx` is *not* mounted. That means:

- **The code (the counting/aggregation logic) can be extracted into a
  shared hook** — e.g. `useInboxOpenCount(sources, {dismissals, snoozes,
  now})` — and called from both `Inbox.tsx` and a new navbar/layout
  component with no duplicated *logic*.
- **The live queries themselves cannot be shared this way without a
  structural change.** Calling that hook from two independent mount points
  (the navbar, which per the finding above is always mounted, and
  `Inbox.tsx`, which is conditionally mounted) creates two independent sets
  of `source.useItems()` subscriptions to the same underlying GROQ queries
  whenever both happen to be on screen at once — real duplicated network
  traffic and listener connections, not just duplicated code.
- **Avoiding that duplication requires lifting the aggregation to a single,
  always-mounted place and having `Inbox.tsx` become a *consumer* rather
  than the owner of that state.** The `studio.components.layout` slot
  (`LayoutProps` at `:7551`, same `renderDefault` shape as the other three)
  is the natural home — it wraps the entire Studio for as long as it's
  open, regardless of which tool or pane is active, unlike `navbar` (same
  lifetime, actually, so `navbar` would work equally well as the provider
  host) or `activeToolLayout` (tool-scoped, wrong lifetime). A production
  plan should register one provider component there that runs each
  source's `useItems()` exactly once and exposes `openCount` (and the full
  per-source reports, if the badge ever wants a breakdown) via context;
  `Inbox.tsx` would then read from that context instead of maintaining its
  own `reports` state and mounting its own `BoundedSourceFeed`s — a real,
  non-trivial refactor of `Inbox.tsx`, `SourceFeed.tsx`, and
  `BoundedSourceFeed`, not a small addition.

### Recommendation

**Proceed to a production plan for the `studio.components.navbar` mechanism
only — not `Tool.icon`.** The navbar override is confirmed real, composes
with Sanity's own default UI via `renderDefault` (no reimplementation), and
was demonstrated end-to-end with a live-updating badge. `Tool.icon`, despite
also being a real, correctly-typed API, is not currently a viable path: it
silently fails to render at all under the common desktop/few-tools
configuration this plugin's own `test-studio` workspaces exercise, which
this spike would not have caught without actually running the Studio and
inspecting network traffic — confirming the type signature alone was not
enough.

The production plan should scope in, as separate, sequenced concerns:

1. The navbar override itself (small, now de-risked).
2. The `openCount`-without-duplicated-queries architecture problem above —
   likely the larger piece of work, and worth scoping as its own step or
   even its own plan, since it touches `Inbox.tsx`'s existing state
   ownership rather than only adding new code.
3. A `warnOnce`-style degrade path for a Studio that already registers its
   own `studio.components.navbar` — this spike's `navbarBadgeSpike.tsx`
   assumes it's the only navbar override in the chain (true in
   `test-studio`, not guaranteed for every consumer), matching this
   repo's `activeToolLayoutProbe.tsx` precedent of proving the composition
   chain still works with two overrides stacked, which this spike did not
   itself test for the `navbar` slot.
4. Whether `toolMenu` (also real, not prototyped here) is a better-scoped
   alternative to the whole-navbar override — same `renderDefault`
   composition, but limited to the tool-list area specifically.

A colocated unit test in `wrapStructure.test.ts`'s style is feasible for the
production version of the navbar override itself (it's a plain
`ComponentType<NavbarProps>`, testable by rendering it with a stub
`renderDefault`), but not for the "does Sanity actually paint my icon"
question this spike had to answer by running a real Studio — that part of
the API surface isn't something a unit test against this plugin's own code
would ever exercise.
