# Plan 030: Extract the duplicated `useAssignableUsers` lookup into one shared hook

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- src/inbox/sources/`
> If any file in that directory changed since this plan was written, re-grep
> for the pattern in "Current state" before proceeding — a source added or
> removed since could change the exact file list below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

The exact same 8-line block — a `useUnavailableUserList` fallback function
plus a module-scope `useAssignableUsers = optionalHook<...>(...)`
declaration — is copy-pasted verbatim across 9 of the 9 `src/inbox/sources/`
files that offer `assign`/`transfer`. This is the shared *primitive*
underneath each source's own `assign` wiring (which is intentionally
repeated per source — see each source's own doc comments on why sources
don't share a base class), but the primitive itself has no reason to exist
9 times. A future rename of the underlying Sanity export
(`'useUserListWithPermissions'`), or any change to the fallback's shape,
requires a lockstep edit across 9 files instead of 1.

## Current state

- Confirmed via `grep -rln "const useAssignableUsers = optionalHook"
  src/inbox/sources/*.ts` — present, byte-for-byte identical in type
  signature and fallback body, in:
  - `src/inbox/sources/assetIssues.ts` (lines 24-32)
  - `src/inbox/sources/documentValidation.ts`
  - `src/inbox/sources/linkCheckerFindings.ts`
  - `src/inbox/sources/needsAttention.ts`
  - `src/inbox/sources/openTasks.ts` (lines 40-54)
  - `src/inbox/sources/todos.ts` (lines 15-22)
  - `src/inbox/sources/unresolvedComments.ts`
  - `src/inbox/sources/unpublishedDrafts.ts`
  - `src/inbox/sources/upcomingReleases.ts`
- Exact shape, from `src/inbox/sources/todos.ts:15-22`:
  ```ts
  /** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
  function useUnavailableUserList(): UserListWithPermissionsHookValue {
    return {data: null, error: null, loading: false}
  }

  // Resolved once at module scope — see `openTasks.ts` for why.
  const useAssignableUsers = optionalHook<
    (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
  >('useUserListWithPermissions', useUnavailableUserList)
  ```
  And from `src/inbox/sources/openTasks.ts:40-54` (identical body, only
  interleaved with that file's own unrelated `useAddonDataset` declaration):
  ```ts
  /** Stands in for `useUserListWithPermissions` when Sanity does not export it — see `unpublishedDrafts.ts`. */
  function useUnavailableUserList(): UserListWithPermissionsHookValue {
    return {data: null, error: null, loading: false}
  }
  // ...
  const useAssignableUsers = optionalHook<
    (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
  >('useUserListWithPermissions', useUnavailableUserList)
  ```
- `src/inbox/sources/capability.ts` (read in full) already exports
  `optionalHook`, `optionalExport`, `optionalContext`, `useSafely` — the
  generic lookup mechanisms — but does not export this one specific,
  fully-resolved composition. This is exactly where the shared version
  belongs: same file, same "reached only through a safe lookup, never a
  static import" convention its own doc comment (lines 8-45) already
  explains at length. `UserListWithPermissionsHookValue`/
  `UserListWithPermissionsOptions` are Sanity's own exported types (from
  `'sanity'`), safe to import by name directly (only the *value* export
  `useUserListWithPermissions` needs the `optionalHook` treatment, per
  `capability.ts`'s own doc comment on why only `@beta`/`@internal`/`@alpha`
  exports need it).
- Every one of the 9 call sites uses the resulting hook the same way:
  `const {data: assignable} = useAssignableUsers({documentValue: null,
  permission: 'update'})` (confirmed identical across all 9 files).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|----------------------|-----------------------|
| Typecheck | `npm run typecheck`  | exit 0, no errors     |
| Lint      | `npm run lint`       | exit 0, no errors     |
| Tests     | `npm test`           | all pass (367 today)  |
| Build     | `npm run build`      | exit 0, clean         |

## Scope

**In scope**:
- `src/inbox/sources/capability.ts` (add the shared export)
- All 9 files listed in "Current state" (remove the local copy, import the
  shared one instead)

**Out of scope**:
- The per-source `assign`/`transfer` wiring itself (the `useMemo` blocks
  building `{users, toUser, unassign}`) — that stays exactly as-is in every
  source; only the `useAssignableUsers` declaration and its fallback move.
- Any other `optionalHook` usage in these files (e.g. `openTasks.ts`'s own
  separate `useAddonDataset` lookup) — untouched.

## Git workflow

- Commits land directly on `main`. Message style:
  `refactor: dedupe the useAssignableUsers lookup into capability.ts`.
- One commit for the whole change is fine — it's mechanical.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the shared export to `capability.ts`

Add, near the other `optionalHook`-based exports in `src/inbox/sources/capability.ts`:

```ts
import {
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

/**
 * Resolved once at module scope, shared by every assignable source —
 * `useUserListWithPermissions` is `@beta` in Sanity's own typings, reached
 * only through `optionalHook` for the reason this file's own top comment
 * explains. Previously redeclared identically in 9 separate source files;
 * consolidated here so a rename only needs one edit.
 */
export const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)
```

Check whether `capability.ts` already imports anything from `'sanity'` by
name before adding the import line — if it currently only does namespace
imports (`import * as sanity from 'sanity'`), add the two types as a
separate named type-only import; that's fine, types are erased at compile
time and don't touch the module-evaluation-safety concern this file's own
doc comment is about (only *value* exports need the namespace-import
treatment).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Update each of the 9 sources

In each of the 9 files listed in "Current state", delete the local
`useUnavailableUserList` function and local `useAssignableUsers` const, and
add `useAssignableUsers` to that file's existing `import {...} from
'./capability'` line (each file already imports `optionalHook` from there —
add `useAssignableUsers` alongside it). Remove the now-unused
`UserListWithPermissionsHookValue`/`UserListWithPermissionsOptions` type
imports from each file's own `'sanity'` import if nothing else in that file
still uses them (check each file individually — don't assume).

Do this one file at a time, running the verify command after each, so a
mistake is caught immediately rather than after all 9:

**Verify** (after each file): `npm run typecheck` → exit 0, no errors
referencing that file.

### Step 3: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

No new tests needed — this is a pure refactor with no behavior change
(every call site already produced, and still produces, the identical
lookup result). The existing test suite (367 tests, including each
source's own `*.test.ts` where present) is the regression guard: if any
source's tests still pass unchanged, the extraction didn't alter behavior.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, same 367 tests passing, no new failures
- [ ] `npm run build` exits 0
- [ ] `grep -rn "function useUnavailableUserList" src/inbox/sources/` returns
      exactly one match (in `capability.ts`)
- [ ] `grep -rln "const useAssignableUsers = optionalHook" src/inbox/sources/`
      returns exactly one match (in `capability.ts`)
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 030 updated

## STOP conditions

- Any of the 9 files' call site to `useAssignableUsers` uses a different
  options shape than `{documentValue: null, permission: 'update'}` when you
  check it (contradicts this plan's "identical across all 9" claim — if
  true, the shared export's type signature may still work, but investigate
  why before assuming it's safe).
- A file among the 9 turns out to use `UserListWithPermissionsHookValue`/
  `UserListWithPermissionsOptions` for something else beyond this
  declaration, in a way that makes removing its own import wrong.

## Maintenance notes

Any *new* source that offers `assign`/`transfer` should import
`useAssignableUsers` from `./capability` from the start, not redeclare it —
this plan exists specifically so that's the obvious, easy path going
forward.
