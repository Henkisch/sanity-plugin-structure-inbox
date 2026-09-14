# Plan 018: Ship the team-wide "who's sitting on what" view as a real Studio tool

> **Executor instructions**: Follow this plan step by step. Every step ends
> in a verification command — run it before moving to the next step. If a
> STOP condition fires, stop and report rather than improvising. This plan
> makes several product decisions explicitly (see "Decisions this plan
> makes, and why" below) so you do not have to guess or re-litigate them —
> follow them as written. When done, update this plan's status row in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat d2cc473..HEAD -- src/plugin.tsx src/index.ts src/inbox/mergeItems.ts src/inbox/sources/unpublishedDrafts.ts src/inbox/sources/openTasks.ts src/inbox/sources/capability.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW (a new, separate, opt-in plugin export and Studio tool — no
  change to `structureInbox()` itself, no change to any existing source or
  the personal Inbox pane)
- **Depends on**: none
- **Category**: direction (production version of Plan 012's spike)
- **Planned at**: commit `d2cc473`, 2026-09-14

## Why this matters

Plan 012's spike prototype (`test-studio/plugins/teamViewSpike.tsx`,
committed) proved the whole mechanism end to end against a real dataset:
`unpublishedDrafts()`/`openTasks({onlyMine: false})`'s already-exported
`useItems()` output can be read directly and grouped by `item.assignee`,
with no new query against the content dataset. Its own Findings additionally
settled the one real open design question empirically: a team view must
**not** reuse `SourceFeed.tsx`/`splitItems()`/`useDismissals()` — the
personal Inbox pane's per-editor dismissal filtering is the wrong building
block here, because `unpublishedDrafts`/`upcomingReleases` have no
`resolve`, so "done" for them is genuinely per-editor-forever, and folding
in any editor's dismissal state would hide still-outstanding work from a
lead asking "what's the team sitting on." This plan turns that proven,
already-de-risked prototype into a real, shipped Studio tool.

## Decisions this plan makes, and why

Plan 012's own recommendation left several things as open questions for
"whoever picks this up next." This plan answers them, rather than leaving
them to the executor to improvise:

1. **A separate, opt-in plugin export (`structureInboxTeamView()`), not
   bundled into `structureInbox()` itself.** This view has a different
   audience (a lead surveying the whole team) than the personal Inbox pane
   (an individual's own queue) — a Studio that wants the personal pane has
   no reason to also get a second tool it never asked for. Consistent with
   how this plugin already ships `inboxListItem` as a separate, optional
   export rather than forcing it into `structureInbox()`'s own tool.
2. **Show every assignable team member, including one with zero currently-open
   items, not only those the spike happened to find items for.** A lead
   asking "who's sitting on what" benefits as much from seeing "nothing" next
   to someone's name (confirms the roster, shows nobody's silently
   overloaded while someone else has nothing) as from seeing a full bucket.
   The spike only ever created a bucket for an assignee already present in
   the data; this plan fetches the real roster via
   `useUserListWithPermissions` (already used by `unpublishedDrafts.ts` and
   `openTasks.ts`, reached the same way) and seeds every team member's
   bucket up front.
3. **No new permissions/visibility gating.** `unpublishedDrafts`/`openTasks`
   are already `audience: 'everyone'` sources an editor can read via the
   personal Inbox pane today; this view surfaces the same data, grouped
   differently. It adds no new exposure beyond what is already true (see
   `plans/README.md`'s existing "Privacy note" finding, which already
   documents that this plugin's per-editor state is dataset-readable by
   design). Restricting *who can open this tool* (e.g. leads only) is a
   real, legitimate future ask, but it is a distinct feature (Sanity tools
   support conditional visibility per user); building it speculatively here
   without a concrete requirement would be scope creep. Out of scope,
   flagged in Maintenance notes.
4. **Read-only — no resolve/assign/snooze wired up**, matching the spike
   exactly. Interactivity from this view is a materially different,
   separate plan (it would need per-row actions reaching back into sources
   this view does not own the selection state for) — not attempted here.

## Current state

**`test-studio/plugins/teamViewSpike.tsx`** (whole file, already committed
on `main` — the proven prototype this plan generalizes into shipped code;
already quoted in full in Plan 012's own Findings, re-read it directly
before starting to confirm it has not drifted).

**`src/inbox/mergeItems.ts`** (whole file — the sibling pure-grouping module
this plan's new file matches in shape and test style):

```ts
export interface MergedRow {
  key: string
  sourceName: string
  item: InboxItem
}

export function compareMergedRows(a: MergedRow, b: MergedRow): number { /* ... */ }

export function mergeRows(
  reports: Record<string, SourceReport>,
  order: string[],
  view: InboxView,
): MergedRow[] {
  const rows: MergedRow[] = []
  for (const sourceName of order) {
    const report = reports[sourceName]
    if (!report) continue
    const items = view === 'done' ? report.done : view === 'snoozed' ? report.snoozed : report.open
    for (const item of items) {
      rows.push({key: `${sourceName} ${item.id}`, sourceName, item})
    }
  }
  return rows.sort(compareMergedRows)
}
```

**`src/inbox/sources/capability.ts`** (whole file, 40 lines — the
`optionalHook` wrapper this plan's roster fetch must go through, since
`useUserListWithPermissions` is `@beta`; already quoted in full above under
"Repo conventions").

**`src/inbox/sources/unpublishedDrafts.ts:39-43, 161-171`** — the exact
reach-through-`optionalHook` pattern for `useUserListWithPermissions`, and
the shape it returns (already used twice in this codebase; this plan reuses
it a third time, the same way, not a new pattern):

```ts
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)
```

```ts
// null documentValue: not scoped to one document, since any team member is
// a sensible entry in the roster.
const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
```

`assignable` (once loaded) is an array of `{id, displayName, email,
imageUrl, granted}` — read `unpublishedDrafts.ts`'s `assigneesById`
construction (a few lines below the excerpt above) directly for the exact
field names before writing Step 2's code, since this plan's roster mapping
must match them precisely.

**`src/plugin.tsx`** (whole file, 73 lines — where `structureInbox` is
defined; this plan's new export lives in a **new, separate** file/plugin
function, not inside this one — see Scope).

**`src/index.ts`** (current export list — where the new plugin's export
line joins, its own new group, not folded into the existing ones).

**Repo conventions to match**:

- A pure grouping/sorting function lives in its own small file with a
  colocated `*.test.ts` — see `mergeItems.ts`/`mergeItems.test.ts`.
- A `@beta` Sanity API is reached only via `optionalHook`, never a static
  named import — see `capability.ts`'s own doc comment for why, quoted
  above.
- A shipped Studio tool is registered via `tools: (prev) => [...prev, {...}]`
  inside a `definePlugin(...)` call — see `test-studio/plugins/teamViewSpike.tsx`'s
  own registration for the exact shape (this plan's real version follows the
  same shape, just exported from `src/` instead of living in `test-studio/`).

## Scope

**In scope**:
- `src/inbox/groupByAssignee.ts` (create) — the extracted, pure grouping
  function.
- `src/inbox/groupByAssignee.test.ts` (create) — unit tests.
- `src/teamView/TeamViewTool.tsx` (create) — the tool's own React component,
  reusing the spike's rendering approach, now reading a real roster too.
- `src/teamView/structureInboxTeamView.ts` (create) — the new, separate
  `definePlugin(...)` export (the `tools: (prev) => ...` registration,
  mirroring `structureInbox`'s own shape in `src/plugin.tsx` but as its own
  independent plugin function).
- `src/index.ts` — export `structureInboxTeamView` and its options type.
- `README.md` — a new top-level section documenting the tool, its default
  sources, and explicitly stating the "no permissions gating" decision from
  above so a consumer isn't surprised by it.
- `test-studio/sanity.config.ts` — swap the throwaway `teamViewSpike` plugin
  for the real `structureInboxTeamView()` export, in the same
  `teamViewSpike` workspace (rename the workspace's `title` to say so is
  optional; keep the `basePath` stable or update
  `plans/012-team-wide-view.md`'s references if you change it — prefer not
  changing it).
- `test-studio/plugins/teamViewSpike.tsx` — **delete** (superseded by the
  real export) once the workspace config points at the real thing.

**Out of scope**:
- `src/inbox/sources/unpublishedDrafts.ts`, `src/inbox/sources/openTasks.ts`
  — this plan reuses their existing output, it does not change what they
  produce.
- Any interactivity (resolve/assign/snooze) on this view's own rows — see
  Decision 4 above.
- Any access-control/visibility gating on the new tool — see Decision 3.
- `src/inbox/mergeItems.ts`, `src/inbox/SourceFeed.tsx`,
  `src/store/useDismissals.ts` — none of these are touched; this view
  deliberately does not go through them (see "Why this matters").

## Git workflow

- Branch: `advisor/018-team-view-production`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period: e.g. `feat: ship the team-wide assignee view as a
  real Studio tool`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |
| Dev       | `npm run dev`          | serves at `http://localhost:3333` — manual verification, see Step 5 |

## Steps

### Step 1: Extract the pure grouping function

Read `test-studio/plugins/teamViewSpike.tsx`'s `assigneeKey`/grouping
`useMemo` block directly, then create `src/inbox/groupByAssignee.ts`:

```ts
import {type InboxItem} from './types'

export interface AssigneeGroup {
  /** A team member's display label, or `'Unassigned'`. */
  assignee: string
  imageUrl?: string
  items: InboxItem[]
}

/**
 * Groups items by `item.assignee`, seeding a bucket for every name in
 * `knownAssignees` even if it ends up empty — a team lead benefits from
 * seeing "nothing" next to someone's name as much as from a full bucket
 * (confirms the roster, and that nobody is silently overloaded while
 * someone else has nothing). `'Unassigned'` always sorts last: an assignee
 * bucket is the point of this view, an unowned pile is the leftover.
 */
export function groupByAssignee(
  items: readonly InboxItem[],
  knownAssignees: readonly {label: string; imageUrl?: string}[],
): AssigneeGroup[] {
  const byAssignee = new Map<string, AssigneeGroup>()

  for (const known of knownAssignees) {
    byAssignee.set(known.label, {assignee: known.label, imageUrl: known.imageUrl, items: []})
  }

  for (const item of items) {
    const key = item.assignee?.label ?? 'Unassigned'
    const existing = byAssignee.get(key)
    if (existing) existing.items.push(item)
    else byAssignee.set(key, {assignee: key, imageUrl: item.assignee?.imageUrl, items: [item]})
  }

  return [...byAssignee.values()].sort((a, b) => {
    if (a.assignee === 'Unassigned') return 1
    if (b.assignee === 'Unassigned') return -1
    return a.assignee.localeCompare(b.assignee)
  })
}
```

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Tests for the grouping function

Create `src/inbox/groupByAssignee.test.ts`, modeled on
`mergeItems.test.ts`'s fixture style. Cover:

1. Items with an assignee are grouped under that assignee's label.
2. Items with no assignee land in `'Unassigned'`.
3. `'Unassigned'` always sorts last, regardless of alphabetical order among
   named assignees.
4. A name in `knownAssignees` with no matching items still produces an
   empty-`items` group (the "show zero-item team members" decision).
5. An item whose assignee is *not* in `knownAssignees` (a real possibility —
   `unpublishedDrafts`'s own assignee join uses whoever has `update`
   permission at read time, which can differ slightly from a separately
   fetched roster snapshot) still gets its own group rather than being
   silently dropped.

**Verify**: `npm test -- groupByAssignee` → all pass.

### Step 3: Build the tool component

Create `src/teamView/TeamViewTool.tsx`. Read
`test-studio/plugins/teamViewSpike.tsx` directly for the rendering shape to
follow (loading/error states, per-group cards) — reuse it, wiring in
`groupByAssignee` and a real roster:

```tsx
import {UsersIcon} from '@sanity/icons/Users'
import {Avatar, Box, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useMemo} from 'react'
import {
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {groupByAssignee} from '../inbox/groupByAssignee'
import {optionalHook} from '../inbox/sources/capability'
import {type InboxSource} from '../inbox/types'

function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

export interface TeamViewToolOptions {
  sources: InboxSource[]
  title: string
}

export function createTeamViewTool(options: TeamViewToolOptions) {
  const {sources, title} = options

  return function TeamViewTool() {
    const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

    // One `useItems()` call per configured source — the same thing
    // `SourceFeed.tsx` does, called directly rather than through it (see
    // this plan's "Why this matters": this view must not go through
    // per-editor dismissal filtering).
    const results = sources.map((source) => source.useItems())

    const items = useMemo(() => results.flatMap((result) => result.items), [results])
    const loading = results.some((result) => result.loading)
    const error = results.find((result) => result.error)?.error

    const knownAssignees = useMemo(
      () =>
        (assignable ?? [])
          .filter((user) => user.granted)
          .map((user) => ({label: user.displayName || user.email || user.id, imageUrl: user.imageUrl})),
      [assignable],
    )

    const groups = useMemo(() => groupByAssignee(items, knownAssignees), [items, knownAssignees])

    return (
      <Box padding={4}>
        <Stack gap={4}>
          <Heading size={2}>{title}</Heading>

          {loading && <Text size={1}>Loading…</Text>}
          {error && (
            <Card padding={3} radius={2} tone="critical">
              <Text size={1}>{error.message}</Text>
            </Card>
          )}
          {!loading && !error && groups.length === 0 && <Text size={1}>Nothing open right now.</Text>}

          {groups.map((group) => (
            <Card key={group.assignee} padding={3} radius={2} shadow={1}>
              <Stack gap={3}>
                <Flex align="center" gap={2}>
                  <Avatar
                    initials={group.assignee === 'Unassigned' ? undefined : group.assignee}
                    size={0}
                    src={group.imageUrl}
                  />
                  <Text weight="semibold">
                    {group.assignee} ({group.items.length})
                  </Text>
                </Flex>
                {group.items.length > 0 && (
                  <Stack gap={2}>
                    {group.items.map((item) => (
                      <Text key={item.id} size={1}>
                        {item.title}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      </Box>
    )
  }
}
```

Note: `sources.map((source) => source.useItems())` calls a hook inside a
`.map()` over a plain array — this is safe **only** because `sources` is a
config value fixed at plugin-registration time (identical array, same
length, same order, every render — it comes from `createTeamViewTool`'s own
closure, never from state), so the number and order of hook calls never
changes across renders, satisfying the rules of hooks. If you find yourself
wanting to make `sources` dynamic (state-driven) later, this pattern would
need to change (one component per source, like `SourceFeed.tsx` does) —
flag it, do not "fix" the rules-of-hooks violation that would introduce by
guessing at a restructure here.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: The plugin export

Create `src/teamView/structureInboxTeamView.ts`:

```ts
import {UsersIcon} from '@sanity/icons/Users'
import {definePlugin, type Tool} from 'sanity'

import {unpublishedDrafts} from '../inbox/sources/unpublishedDrafts'
import {openTasks} from '../inbox/sources/openTasks'
import {type InboxSource} from '../inbox/types'
import {createTeamViewTool} from './TeamViewTool'

export interface StructureInboxTeamViewConfig {
  /**
   * The `'everyone'`-audience sources to aggregate. Defaults to
   * `[unpublishedDrafts(), openTasks({onlyMine: false})]`.
   *
   * Any `audience: 'mine'` source you pass (e.g. `todos()`) is silently
   * dropped — a personal scratch list has no place in a team-wide view, the
   * same reasoning `todos()` itself documents for why it is always
   * `audience: 'mine'`.
   */
  sources?: InboxSource[]
  /** Tool name. @defaultValue 'structure-inbox-team-view' */
  toolName?: string
  /** Title shown on the tool's own tab. @defaultValue 'Team' */
  title?: string
}

/**
 * A separate, opt-in Studio tool: every configured `'everyone'`-audience
 * source's currently-open items, grouped by assignee instead of by
 * tone/timestamp — "who's sitting on what," for a lead surveying the whole
 * team rather than one editor's own queue.
 *
 * Deliberately not part of `structureInbox()` itself — a different
 * audience, a different question. Add both if you want both:
 *
 * ```ts
 * plugins: [
 *   structureTool(),
 *   structureInbox({sources: [...]}),
 *   structureInboxTeamView(),
 * ]
 * ```
 *
 * @public
 */
export const structureInboxTeamView = definePlugin<StructureInboxTeamViewConfig | void>(
  (options) => {
    const sources = (options?.sources ?? [unpublishedDrafts(), openTasks({onlyMine: false})])
      .filter((source) => (source.audience ?? 'everyone') === 'everyone')
    const toolName = options?.toolName ?? 'structure-inbox-team-view'
    const title = options?.title ?? 'Team'

    return {
      name: 'sanity-plugin-structure-inbox/team-view',
      tools: (prev): Tool[] => [
        ...prev,
        {
          name: toolName,
          title,
          icon: UsersIcon,
          component: createTeamViewTool({sources, title}),
        },
      ],
    }
  },
)
```

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Export it, wire test-studio, manual verification

In `src/index.ts`, add its own new export group:

```ts
export {
  structureInboxTeamView,
  type StructureInboxTeamViewConfig,
} from './teamView/structureInboxTeamView'
```

In `test-studio/sanity.config.ts`'s `teamViewSpike` workspace, replace the
`teamViewSpike()` plugin import/usage with `structureInboxTeamView()` from
`sanity-plugin-structure-inbox`. Delete
`test-studio/plugins/teamViewSpike.tsx` (superseded).

**Verify**: `npm run build && npm run dev`, open the `team-view-spike`
workspace (or whatever its `basePath` is), confirm:
1. The new "Team" tool tab appears and opens without error.
2. Real drafts/tasks from the dataset appear, grouped by assignee, matching
   what the old spike showed.
3. At least one team member with zero currently-open items appears with an
   empty group (the roster-seeding decision) — if the dataset's roster
   happens to have everyone holding at least one item, note that in your
   report rather than treating it as unverifiable; do not fabricate a test
   user to force this case.

### Step 6: README

Add a new top-level section (after "Getting back to the Inbox",
`README.md:362-380` in the current file — re-locate if it has moved),
documenting `structureInboxTeamView()`: what it shows, that it is a
separate opt-in tool, the default sources, and the explicit "no visibility
gating" decision from this plan's own reasoning above, stated plainly so a
consumer isn't surprised: *"Every editor who can open this tool sees the
same aggregated view — the same `'everyone'`-audience data already readable
through the personal Inbox pane, just grouped differently. Restricting who
can open the tool itself is your Studio's own access-control setup to make,
same as any other tool."*

**Verify**: manually re-read for sense.

### Step 7: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- New file: `src/inbox/groupByAssignee.test.ts`, the 5 cases in Step 2.
- Step 5's manual verification in `test-studio` is the real proof the tool
  works end to end against a live dataset, and is not optional.
- No test attempts to mount `TeamViewTool`/`createTeamViewTool` directly —
  same honest limitation as `Inbox.tsx`'s own untested integration surface
  (it needs `useClient`-level Studio context); the pure `groupByAssignee`
  function is what is actually unit-testable here.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including `groupByAssignee.test.ts`'s 5 new cases
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "structureInboxTeamView" src/index.ts` finds the new export
- [ ] `test-studio/plugins/teamViewSpike.tsx` no longer exists (`test -f`
  fails on it)
- [ ] Step 5's manual verification performed and its result reported
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 018 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `unpublishedDrafts()`/`openTasks()`'s exported shapes, or
  `useUserListWithPermissions`'s return shape (`{id, displayName, email,
  imageUrl, granted}`), have changed from what "Current state" quotes.
- You find yourself wanting to add resolve/assign/snooze interactivity to
  make the tool feel more complete — that is a separate, later plan (see
  Decision 4); this plan's scope is a read-only view.
- You find yourself wanting to add a permissions/role check before showing a
  bucket, or before the tool itself opens — that is Decision 3, deliberately
  out of scope; report the temptation rather than building it.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If a future consumer asks for the tool to be restricted to certain roles,
  that is a legitimate, separate feature — Sanity tools can be filtered per
  user in a Studio's own `tools: (prev) => ...` composition, the same
  mechanism this plugin already uses; it does not require changing anything
  in this plan's own code, only how a consumer configures their Studio
  (or, if this plugin wants to make it easier, a new
  `StructureInboxTeamViewConfig` option in a later plan).
- The `sources.map((source) => source.useItems())` pattern in
  `TeamViewTool.tsx` only stays rules-of-hooks-safe as long as `sources` is
  a fixed array at plugin-registration time. A reviewer touching this file
  later should re-check that invariant before making `sources` any more
  dynamic than it is today.
- `groupByAssignee` is a small, pure, reusable building block — if a future
  plan wants a differently-scoped aggregate view (by document type, by
  urgency), model it the same way this one models grouping by assignee,
  rather than growing this one function's responsibilities.
