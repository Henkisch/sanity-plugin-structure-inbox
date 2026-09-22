# Plan 085: One assignment capability, with the target-id choice made explicit

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/ src/inbox/types.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED — assignment writes live customer data, and the eight copies **deliberately differ** in one axis. A shared hook that guesses that axis would fail silently.
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Two near-identical blocks are copied across eight sources:

`assigneesById = useMemo(...)` — the same ~10 lines building a user map with
the same `isSelf`/`profileImage` fallback — at `assetIssues.ts:607`,
`documentValidation.ts:362`, `linkCheckerFindings.ts:485`, `openTasks.ts:341`,
`unresolvedComments.ts:228`, `needsAttention.ts:173`,
`upcomingReleases.ts:119`, `unpublishedDrafts.ts:258`.

`const assign = useMemo(...)` — the same `if (!assignable) return undefined` /
`.filter(granted).map(...)` / `toUser` / `unassign` block — at
`assetIssues.ts:856`, `linkCheckerFindings.ts:508`,
`documentValidation.ts:425`, `needsAttention.ts:242`,
`upcomingReleases.ts:162`, `unresolvedComments.ts:297`,
`unpublishedDrafts.ts:332`.

**The reason this is worth fixing is not the line count — it is that the copies
differ in exactly one dangerous way.** Which id they assign against:

- `item.id`: `needsAttention.ts:250`, `upcomingReleases.ts:170`,
  `unresolvedComments.ts:307`, `assetIssues.ts:864`,
  `linkCheckerFindings.ts:515`
- `item.intent?.params.id` (and a silent no-op when absent):
  `documentValidation.ts:432-438`, `unpublishedDrafts.ts:342-348`

Both are correct **for their own source**: a release's `item.id` is the release
document id while its intent carries the short release id, and a draft's
`item.id` is `drafts.`-prefixed. That divergence is precisely what makes the
ninth copy hazardous — the wrong variant assigns against the wrong id and fails
silently. Plan 060 hit the same class of bug from the other direction
(draft-prefixed ids silently killing an edit intent).

Plan 030 already extracted `useAssignableUsers` for this reason and stopped one
layer short.

## Current state

Read at least three of the eight `assigneesById` copies and both `assign`
variants before starting, so you can see what genuinely varies.

Existing shared layer to extend, not duplicate: `src/inbox/sources/capability.ts`
(`useAssignableUsers`, `optionalHook`, `useSafely`),
`src/inbox/sources/assignmentStore.ts` (`useAssignmentStore`, `assignmentDocId`).

**What is explicitly NOT worth sharing** (so you do not widen this): the per-source
GROQ, and `liveQuery$`. Those are already the shared layer and the remaining
per-source code is genuinely per-source.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Sources | `npx vitest run src/inbox/sources/` | all pass |
| Full tests | `npm test` | all pass |
| Build | `npm run build` | `[success]` |

## Scope

**In scope:** a new hook beside `src/inbox/sources/capability.ts`, its test
file, and the eight source files — migrated **one at a time**.

**Out of scope:**
- `liveQuery$`, `capability.ts`'s existing helpers, and the per-source GROQ.
- `assignmentStore.ts`'s hashing and its known two-hash collision (recorded separately in `plans/README.md`).
- `suggestAssignee` implementations, unless the hook takes one as an optional parameter — decide in Step 1 and say so.

## Git workflow

- Branch: `advisor/085-assign-capability`
- Conventional Commits: `refactor:`. **One commit per migrated source**, so a
  regression can be bisected to a single source.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Design the hook so the dangerous axis cannot be inherited

```ts
/**
 * The assignee map and the `assign` capability, shared by every source that
 * offers assignment.
 *
 * `targetId` is **required and has no default**, on purpose. The eight sources
 * this replaces deliberately disagreed about which id to assign against —
 * five use `item.id`, two use `item.intent?.params.id`, and each is correct
 * for its own source (a release's `item.id` is the release *document* id; a
 * draft's is `drafts.`-prefixed). A default would let the ninth source
 * inherit the wrong one and fail silently, which is the same class of bug
 * plan 060 hit with draft-prefixed ids in an edit intent.
 */
export function useAssignmentCapability(
  client: SanityClient,
  options: {
    targetId: (item: InboxItem) => string | undefined,
    suggestAssignee?: ...,
  },
): {assigneesById: Map<string, AssigneeInfo>; assign: AssignCapability | undefined}
```

Make `targetId` a **required** property. Do not give it a default. Do not make
it optional with a fallback.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Migrate one source and diff the result shape

Pick `needsAttention` (it is small and uses the `item.id` variant). Before
replacing anything, capture the shape of its current `assign` object; after
migrating, confirm it is identical — same `users` array contents and order,
same `toUser`/`unassign` behaviour.

**Verify**: `npx vitest run src/inbox/sources/needsAttention.test.ts` → all
pass with no test modified. Report the before/after `assign` shape.

### Step 3: Migrate the remaining seven, one commit each

For each, **read which id variant that source uses today** and pass exactly
that. Do not infer it from a sibling.

For the two `item.intent?.params.id` sources (`documentValidation`,
`unpublishedDrafts`), preserve the existing silent no-op when the id is absent
— or, better, make it a `warnOnce` so it stops being silent. If you change it,
say so; it is a behaviour change, however small.

**Verify**: after each source, `npx vitest run src/inbox/sources/` → all pass.

### Step 4: Confirm identity stability

Every one of these feeds `InboxSourceResult.assign`, which flows through
`SourceFeed`'s fingerprint machinery. The hook's returned `assign` must not
churn identity per render.

**Verify**: in the hook's own test, `rerender` with unchanged inputs and assert
`assign` is referentially equal. Also confirm `SourceFeed`'s
`assignUserCount` fingerprint still behaves (read
`src/inbox/SourceFeed.tsx:164`).

## Test plan

New test file for the hook:

1. `assigneesById` includes the current user with their profile image
   (the `isSelf` branch).
2. `assign` is `undefined` when `assignable` is absent.
3. `assign.users` contains only `granted` users.
4. `toUser` writes against the id `targetId` returned — **the test that pins
   the dangerous axis**. Assert with a `targetId` that deliberately differs
   from `item.id`.
5. `targetId` returning `undefined` does not write (and warns, if Step 3
   changed that).
6. The returned object is referentially stable across a re-render.

Existing source tests must pass unchanged.

**Verify**: `npm test` → all pass, 6 new tests, zero modified.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] **No existing test modified**
- [ ] All eight sources use the hook; `grep -c "assigneesById = useMemo" src/inbox/sources/*.ts` → 0
- [ ] `targetId` is a required parameter with no default (`grep -n "targetId" <hook file>` confirms)
- [ ] Your report lists, per source, which id variant it passes and that it matches what that source used before
- [ ] One commit per migrated source
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any source's current id variant is ambiguous from reading the code. Stop and
  ask — guessing is the exact failure this plan is designed to prevent.
- A source's `assign` shape differs after migration (different user order,
  different filtering). Report it rather than accepting "close enough":
  these write live data.
- The hook's returned `assign` cannot be made referentially stable. Do not
  ship it; identity churn in a reported capability is the crash class
  `AGENTS.md` records three times.
- More than two sources turn out to need special-casing beyond `targetId`.
  Then the abstraction is wrong — report, and consider leaving those two out.

## Maintenance notes

- The `targetId` parameter is the whole design. If a future change gives it a
  default "for convenience", this plan's value is gone and the ninth source
  will inherit a wrong id silently.
- A reviewer should check the per-source `targetId` table in the report against
  the pre-migration code, source by source. That is the only way to verify this
  refactor did not quietly reassign the wrong documents.
- Deliberately not shared: per-source GROQ and `liveQuery$` usage. The
  duplication that was worth fixing was narrower than "sources repeat
  scaffolding".
