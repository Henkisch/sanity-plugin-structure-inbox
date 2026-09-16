# Plan 045: Let an integrator turn off Summarize/Suggest todos specifically

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2cbbb20..HEAD -- src/types.ts src/structure/resolveConfig.ts src/structure/inboxNode.tsx src/structure/InboxPane.tsx src/inbox/Inbox.tsx`
> If any of these changed since this plan was written, re-read them in full
> and compare against the excerpts below before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (purely additive — every new option defaults to today's
  existing behavior, so no existing consumer sees a change)
- **Depends on**: none
- **Category**: cost / feature (requested directly by the maintainer
  during this plugin's own AI-cost research: "the ability to opt out of
  some features that are ai heavy is a good thing")
- **Planned at**: commit `2cbbb20`, 2026-09-16

## Why this matters

Two of this pane's four pane-wide AI reads already have a real
config-level off switch: `ask` (default `false`) and `contentGaps`
(default off, a marker object). The other two — Summarize and Suggest
todos — have **no** switch at all: they're unconditionally available the
instant Agent Actions resolve in the Studio, with no way for an
integrator to turn either off individually short of disabling Agent
Actions Studio-wide (which would also take out `assess`/`proposeFix`/
`suggestSnooze`/`ask`/`contentGaps` — a much bigger hammer than "we don't
want Summarize costing us credits, but we do want Ask").

This plugin's own AI-cost research (this session) found the real
billing mechanic behind why this matters: every AI read here is a flat
**1 credit ($0.05) per request**, metered against the organization's own
monthly AI-credit allowance — not every organization installing this
plugin has a large one. Giving cost-conscious integrators (or ones on a
tight free-tier allowance) a real lever to keep the AI footprint as small
as they want, feature by feature, directly serves "keep this plugin
available to everyone," not just those with headroom to spare.

## Current state

- `src/types.ts:51-84` — the existing precedent, both options already
  read in full this session:
  ```ts
  /**
   * Lets an editor select rows by asking a plain-language question...
   * @defaultValue false
   */
  ask?: boolean

  /**
   * Enables "Find content gaps"...
   * Still a marker object, not a boolean — leaves room for its own
   * options later without a breaking change...
   * @defaultValue undefined (off)
   */
  contentGaps?: Record<string, never>
  ```
  Summarize/Suggest todos have no equivalent entry in this interface at
  all today (confirmed: `grep -n "summarize\|suggestTodos" src/types.ts`
  returns nothing).
- `src/structure/resolveConfig.ts` — the entire file (21 lines), fills in
  every default once:
  ```ts
  export function resolveConfig(config: StructureInboxConfig = {}): ResolvedStructureInboxConfig {
    return {
      toolName: config.toolName ?? DEFAULT_TOOL_NAME,
      showInList: config.showInList ?? false,
      redirectOnLanding: config.redirectOnLanding ?? true,
      sources: config.sources ?? [],
      ask: config.ask ?? false,
      title: config.title,
      contentGaps: config.contentGaps,
      context: config.context,
    }
  }
  ```
- `src/structure/inboxNode.tsx:37-49` — `inboxComponent`'s own
  `.options({sources, ask, contentGaps, context})` call, handing the
  resolved config to the pane.
- `src/structure/InboxPane.tsx` — the entire file (35 lines):
  ```ts
  interface InboxPaneProps {
    options?: {
      sources?: InboxSource[]
      ask?: boolean
      contentGaps?: StructureInboxConfig['contentGaps']
      context?: string
    }
  }

  export function InboxPane(props: InboxPaneProps) {
    return (
      <Inbox
        ask={props.options?.ask ?? false}
        contentGaps={props.options?.contentGaps}
        context={props.options?.context}
        sources={props.options?.sources ?? []}
      />
    )
  }
  ```
- `src/inbox/Inbox.tsx:63-71` (`InboxProps`) and `:353`
  (`export function Inbox({sources, ask = false, contentGaps, context}:
  InboxProps)`) — where the resolved values finally reach the component
  that actually renders the "AI insights" menu.
- `src/inbox/Inbox.tsx`'s `mainColumnActions` (read in full this
  session): the `MenuItem` for Summarize renders unconditionally; the one
  for Suggest todos is gated only on `addTodo` (whether a `todos` source
  is configured, nothing about intent to disable AI); the one for Find
  content gaps is gated on `contentGaps` being configured — the exact
  pattern this plan extends to the other two.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/types.ts` (two new `StructureInboxConfig` options)
- `src/structure/resolveConfig.ts`
- `src/structure/inboxNode.tsx`
- `src/structure/InboxPane.tsx`
- `src/inbox/Inbox.tsx` (`InboxProps`, the two `MenuItem`s' own gating)
- `README.md` (the Options table, and wherever Summarize/Suggest todos
  are described)
- Each touched file's own test file

**Out of scope**:
- `ask`/`contentGaps` themselves — unchanged, already have their own
  switch.
- Any per-item AI capability (`assess`, `proposeFix`) — those already
  have their own per-source `ai?: boolean` option where relevant (see
  `unpublishedDrafts.ts`); this plan is scoped to the two pane-wide reads
  that currently have none.
- `suggestSnooze` — covered by Plan 043 (a different problem — no click
  at all, not "no way to disable").

## Git workflow

- Commits land directly on `main`. Message style: `feat: let an
  integrator disable Summarize/Suggest todos individually`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the two new config options

In `src/types.ts`, add, near `ask`/`contentGaps`:

```ts
/**
 * Set to `false` to remove the "Summarize" pane-wide AI read entirely —
 * no menu item, no cost, ever. On by default, unlike `ask`/`contentGaps`:
 * this reads only what's already on screen (no extra dataset survey) and
 * has been part of this pane's own baseline experience since it shipped.
 * Turn it off if your organization wants a real, config-level lever to
 * keep this specific read's AI-credit cost at zero regardless of what
 * any individual editor might click.
 *
 * @defaultValue true
 */
summarize?: boolean

/**
 * Set to `false` to remove the "Suggest todos" pane-wide AI read
 * entirely — same reasoning as `summarize` above. Already conditional on
 * a `todos` source being configured at all; this is an *additional* gate,
 * for turning it off even when `todos` is present.
 *
 * @defaultValue true
 */
suggestTodos?: boolean
```

**Verify**: `npm run typecheck` → exit 0 (no consumer yet, just confirms
the file itself is valid).

### Step 2: Thread the defaults through `resolveConfig.ts`

```ts
export function resolveConfig(config: StructureInboxConfig = {}): ResolvedStructureInboxConfig {
  return {
    toolName: config.toolName ?? DEFAULT_TOOL_NAME,
    showInList: config.showInList ?? false,
    redirectOnLanding: config.redirectOnLanding ?? true,
    sources: config.sources ?? [],
    ask: config.ask ?? false,
    summarize: config.summarize ?? true,
    suggestTodos: config.suggestTodos ?? true,
    title: config.title,
    contentGaps: config.contentGaps,
    context: config.context,
  }
}
```

Add the same two fields to `ResolvedStructureInboxConfig` in
`src/types.ts` if that type is declared explicitly there (check first —
it may already be derived structurally rather than listing every field by
hand).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Thread through `inboxNode.tsx` and `InboxPane.tsx`

In `inboxNode.tsx`'s `.options({...})` call, add `summarize:
config.summarize, suggestTodos: config.suggestTodos`. In
`InboxPane.tsx`'s own `InboxPaneProps['options']` and its `<Inbox
.../>` render, add and pass through both (with the same `?? true`
fallback the other resolved-at-this-layer options already use, e.g.
`ask={props.options?.ask ?? false}`'s own pattern — mirror it with `??
true` for these two).

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Gate the two `MenuItem`s in `Inbox.tsx`

Add `summarize = true` and `suggestTodos = true` to the destructured
`InboxProps` in the `Inbox` function signature, alongside `ask = false`.
Wrap the existing Summarize `MenuItem` in `{summarize && (...)}` and add
`suggestTodos &&` to the existing `addTodo &&` condition on the Suggest
todos `MenuItem` (`{suggestTodos && addTodo && (...)}` — both must be true
now, matching how `contentGaps &&` already gates its own item). Also
guard the two handlers themselves (`handleSummarize`/
`handleSuggestTodos`) with an early return when their own flag is off —
belt-and-suspenders against a direct call some other code path might make,
matching how `agentClient` absence is already checked defensively inside
each handler rather than only at the render call site.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Tests

Add cases (wherever `Inbox.test.tsx`'s existing suite renders `<Inbox
.../>`) confirming: `summarize={false}` hides the Summarize menu item
entirely (and calling the underlying handler, if reachable in a test,
does not call the AI); same for `suggestTodos={false}`. Also confirm the
default (`summarize`/`suggestTodos` omitted entirely) still shows both,
matching today's existing behavior exactly — this is the regression case
proving the change is truly additive.

**Verify**: `npm test -- Inbox` → all pass, including new cases.

### Step 6: Update `README.md`

Add both new options to the "## Options" table (same row shape
`context`/`ask` already use), and update the sections describing
Summarize/Suggest todos to mention the new opt-out.

**Verify**: `grep -n "summarize\|suggestTodos" README.md` → both appear
in the Options table.

### Step 7: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New cases in `Inbox.test.tsx`: `summarize={false}` hides its menu item;
  `suggestTodos={false}` hides its menu item (with a `todos` source
  configured, to isolate this flag from the existing `addTodo` gate);
  the default (neither passed) still shows both, unchanged from today.
- Verification: `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new case from Step 5 exists and passes
- [ ] `npm run build` exits 0
- [ ] `summarize`/`suggestTodos` both default to `true` — no existing
      consumer's behavior changes by upgrading with neither set
- [ ] Setting either to `false` removes that menu item entirely, with no
      way for its own handler to fire
- [ ] `README.md`'s Options table lists both
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 045 updated

## STOP conditions

- `ResolvedStructureInboxConfig` turns out to be a hand-written interface
  (not structurally derived) and adding two fields to it breaks some
  other consumer of that type in a way this plan's own file list doesn't
  anticipate — re-check every consumer of that type before assuming the
  addition is safe.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

Any future pane-wide AI read should get its own boolean opt-out from the
start (defaulting to whatever preserves existing behavior at the moment
it ships), following this plan's own pattern — `ask`/`contentGaps`
already do; this plan brings the other two in line.
