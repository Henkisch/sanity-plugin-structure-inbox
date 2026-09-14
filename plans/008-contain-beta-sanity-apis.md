# Plan 008: Actually contain the beta Sanity APIs the sources depend on

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c9b9709..HEAD -- src/inbox/sources src/index.ts README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 003 — **merged**, the boundary now wraps the component that calls `useItems()`. Plan 007 (tests) is optional but preferred.
- **Category**: bug
- **Planned at**: commit `c9b9709`, 2026-09-09 (refreshed after plans 001-006 merged)

## Why this matters

Two shipped sources import Sanity APIs that Sanity's own typings mark unstable:
`useAddonDataset` is `@beta @hidden`, and `useActiveReleases` is `@internal`.
The code and the README both claim this risk is contained — that if one of
these moves, "one source stops working rather than the plugin".

That claim is false, and the reason is the import style. Both are **static
named imports**, and `src/index.ts` re-exports all three source modules
unconditionally. So importing *anything* from this package — even by a consumer
who configured neither source — pulls both unstable bindings into the module
graph. If Sanity drops either named export in any v6 minor, the ESM runtime
throws while evaluating the barrel and **the whole Studio fails to boot**, for
every consumer.

The package declares `peerDependencies.sanity: "^6.0.0-0"`, which promises
compatibility across all of v6 while depending on two APIs Sanity explicitly
reserves the right to move. This is the single risk the README foregrounds
most, and it is the one thing the architecture does not deliver.

## Current state

`src/index.ts` — the barrel, in full:

```ts
export {DEFAULT_TOOL_NAME, INBOX_PANE_ID, STRUCTURE_INBOX_NAMESPACE} from './constants'
export {structureInbox} from './plugin'
export {inboxListItem} from './structure/inboxNode'
export type {StructureInboxConfig} from './types'

export type {InboxItem, InboxSource, InboxSourceResult} from './inbox/types'
export {openTasks, type OpenTasksOptions} from './inbox/sources/openTasks'
export {unpublishedDrafts, type UnpublishedDraftsOptions} from './inbox/sources/unpublishedDrafts'
export {upcomingReleases, type UpcomingReleasesOptions} from './inbox/sources/upcomingReleases'

export {SectionCard} from './ui/SectionCard'
```

The unstable imports:

- `src/inbox/sources/openTasks.ts:6` — `import {useAddonDataset, useCurrentUser} from 'sanity'`
- `src/inbox/sources/upcomingReleases.ts:3` — `import {useActiveReleases} from 'sanity'`

(`useCurrentUser` is stable and public — it is not part of this problem.)

`README.md` repeats the containment claim under "### Tasks" and needs to become
true or be corrected. Note plan 003 already corrected `openTasks.ts`'s separate
false comment about tasks-disabled Studios — do not revert that; make your new
comment consistent with it.

Also note both source files now set a `changedAt` field on their items (plan
001). Leave that alone; it is unrelated to this change.

Repo conventions:
- Sources are one file each under `src/inbox/sources/`, exporting a factory
  that returns an `InboxSource`.
- `InboxSourceResult` is `{items, loading?, error?, resolve?}` — a source that
  cannot work reports `{items: [], error}` rather than throwing.
- Comments explain *why*. A comment that asserts a property must be true.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0              |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0              |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `src/inbox/sources/openTasks.ts`
- `src/inbox/sources/upcomingReleases.ts`
- `src/inbox/sources/capability.ts` (create — the shared lookup helper)
- `src/inbox/sources/capability.test.ts` (create)
- `src/i18n/locales/en-US.ts` (one new string)
- `README.md` (the containment claim)

**Out of scope** (do NOT touch):
- `src/inbox/sources/unpublishedDrafts.ts` — uses only stable APIs.
- `src/index.ts`'s export list — the sources must stay exported; this plan
  makes them *safe to import*, it does not remove them.
- `package.json` peer range — narrowing it is a separate decision for the
  maintainer, noted in Maintenance notes.
- The `resolve` implementation in `openTasks` — its behaviour is verified and
  correct.

## Git workflow

- Branch: `advisor/008-contain-beta-apis`
- Conventional commits, e.g. `fix: survive a Sanity release that moves a beta hook`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a namespace-lookup helper

Create `src/inbox/sources/capability.ts`. It imports the `sanity` module as a
namespace — which does **not** fail when a given export is absent — and reads
the hook off it:

```ts
import * as sanity from 'sanity'
```

Export a small typed helper, e.g.
`function optionalHook<T>(name: string): T | undefined`, that returns the
export when it is a function and `undefined` otherwise. Document clearly *why*
the indirection exists: a named import of a missing export is a module-
evaluation error that takes the whole Studio down, and this package re-exports
its sources from the barrel, so that error would reach consumers who use
neither source.

Note the trade-off honestly in the comment: this deliberately trades
compile-time checking at the call site for runtime survivability, so the call
sites must narrow the value themselves.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Route `upcomingReleases` through the helper

In `src/inbox/sources/upcomingReleases.ts`, replace the static named import
with the helper. Inside `useItems`:

- Look the hook up once, at module scope or via the helper.
- **Rules of hooks matter here.** The lookup must not make the hook call
  conditional across renders in a way React rejects. The export is either
  present for the whole life of the process or absent for the whole life of it,
  so resolving it once at module scope and branching on that constant is
  acceptable — but the branch must be stable. If you cannot satisfy the linter
  without a conditional hook call, STOP and report rather than suppressing the
  rule.
- When unsupported, return `{items: [], error: new Error(<message>)}` so the
  section renders the existing error card with a clear reason.

Add the message to `src/i18n/locales/en-US.ts` if you surface it as a
translated string; a plain English `Error.message` is acceptable if that is
simpler, since it lands in the error card's detail line.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npm run lint` → exit 0.

### Step 3: Route `openTasks` through the helper

Same treatment for `useAddonDataset`. Keep `useCurrentUser` as a normal named
import — it is public and stable.

Then correct the file's comment: it currently claims a Studio without tasks
"surfaces here as an empty list rather than an error". After this change the
truthful statement is that an absent hook yields an error card in that one
section. (Plan 003 may already have corrected this comment — if so, make it
consistent with the new behaviour rather than reverting it.)

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 4: Prove the barrel survives a missing export

This is the step that decides whether the plan worked. Write
`src/inbox/sources/capability.test.ts` that mocks the `sanity` module with the
unstable exports **absent**, then imports `src/index.ts` and asserts:

- the import itself does not throw
- `openTasks()` and `upcomingReleases()` can still be constructed
- `structureInbox` is still exported and callable

Use `vi.mock('sanity', ...)` returning an object without `useAddonDataset` or
`useActiveReleases` but with whatever else the barrel's module graph touches at
evaluation time (`definePlugin`, `defineLocaleResourceBundle`, …). If the mock
turns out to need a long list of exports, that is itself worth reporting — it
means the barrel does more work at import time than it should.

**Verify**: `npx vitest run src/inbox/sources/capability.test.ts` → passes.
Confirm it is a real test by checking it fails if you temporarily revert step 2
to a static named import.

### Step 5: Correct the README

Update the "### Tasks" section so the stated guarantee matches reality: the
sources degrade to an error card in their own section, and the Studio still
boots, when Sanity moves one of these APIs.

**Verify**: `grep -n "stops working rather than the plugin" README.md` → judge
whether the surrounding sentence is now accurate; rewrite if not.

## Test plan

- `capability.test.ts` — the barrel-survives-missing-export test from step 4,
  plus a unit test of `optionalHook` returning `undefined` for an absent name
  and the function for a present one.
- Extend the source-level tests from plan 007 with one case per source: when
  the hook is unavailable, `useItems` returns an `error` and no items.

Model the file on `src/store/dismissals.test.ts` for structure.

**Verification**: `npx vitest run` → all pass.

## Done criteria

ALL must hold:

- [ ] `grep -n "^import {useAddonDataset" src/inbox/sources/openTasks.ts` → no match
- [ ] `grep -n "^import {useActiveReleases" src/inbox/sources/upcomingReleases.ts` → no match
- [ ] A test exists that imports `src/index.ts` with both unstable exports
      mocked away and asserts no throw
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0 with **no** new rule suppressions
      (`grep -rn "oxlint-disable" src/inbox/sources/` shows nothing new)
- [ ] `npx vitest run` exits 0
- [ ] `npm run build` prints `[success]`
- [ ] README no longer claims containment the code does not provide
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Satisfying the rules-of-hooks linter requires disabling it. A conditional
  hook call is a real bug; a suppressed lint rule hides it. Report instead.
- `import * as sanity from 'sanity'` does not typecheck, or the package's
  export map makes namespace import impractical.
- Mocking `sanity` for the barrel test requires stubbing more than ~10 exports.
  Report the list — it means the barrel's import-time footprint is the real
  finding.
- You discover the bundler already tree-shakes unused sources, so the failure
  mode does not exist as described. That would make this plan unnecessary —
  report the evidence rather than proceeding.

## Maintenance notes

- **The rule**: any Sanity API marked `@beta`, `@internal` or `@hidden` must be
  reached through `capability.ts`, never a static named import. A named import
  of an unstable export is a Studio-wide boot failure waiting for a minor
  release.
- A reviewer should check that new sources follow this, and that the error
  message names *which* capability is missing — "not available in this Studio
  version" without a name is unactionable.
- Deferred for the maintainer: narrowing `peerDependencies.sanity` from
  `^6.0.0-0` to a known-good minor floor. That is a compatibility promise, not
  a code change, and belongs to whoever owns the release.
