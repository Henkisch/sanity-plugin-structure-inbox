# Plan 071: Stop publishing ~10,000 lines of someone else's types, and a global that can break TypeGen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/index.ts src/inbox/sources/assignmentStore.ts package.json package.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S once the root is confirmed; Step 1 is an investigation.
- **Risk**: MED — the clean fix narrows a published export's parameter type. That is technically a signature change on a 2.x package, even though every real caller keeps working.
- **Depends on**: plan 067 (the API report makes the before/after surface diffable). Execute 067 first if doing both.
- **Category**: tech-debt
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Measured at this commit:

```
$ wc -l dist/index.d.ts dist/link-checker.d.ts
   11380 dist/index.d.ts
     122 dist/link-checker.d.ts
```

The second entry point publishes 122 lines of declarations. The main barrel
publishes **11,380** — because `@sanity/client` is an *inlined* dependency, so
its entire type graph (`SanityClient`, `ObservableSanityClient`, `Patch`,
`Transaction`, `ReleasesClient`, `AgentActionsClient`, plus rxjs's
`Observable`/`Subscriber`/`Subscription`) is copied in rather than imported.

Two concrete costs:

1. **Every consuming Studio's TypeScript server parses and structurally
   compares an 11k-line declaration file** to type-check a plugin whose real
   surface is a few dozen symbols. That is editor latency in the consumer's
   `sanity.config.ts`.
2. **Three `declare global` blocks ride along**, and one of them re-declares
   `interface SanityQueries` — Sanity TypeGen's own query-result registry.
   A published plugin injecting that into a consumer's global scope is a real
   collision risk for any studio running `sanity typegen`. The other two patch
   `SymbolConstructor.observable` and declare `interface File {}`.

All of it to publish `useAssignmentStore` — internal bookkeeping plumbing that
appears nowhere in the README.

## Current state

The measurement above is reproducible with `wc -l dist/*.d.ts` after
`npm run build`.

**The three globals** — `dist/index.d.ts:619`, `:8642`, `:10452`:

```ts
declare global {
  interface SymbolConstructor {
    readonly observable: symbol;
  }
}
```
```ts
declare global {
  interface File {}
}
```
```ts
declare global {
  /**
   * Query result types, keyed by GROQ query string. Empty by default, `sanity typegen` registers
   * the queries it finds:
   ...
```

`grep -c "interface SanityQueries" dist/index.d.ts` → 5.

**The suspected root.** A prior audit claimed the sole root was
`useAssignmentStore`'s `client: SanityClient` parameter. **That attribution is
unverified and partly wrong** — `grep -c "SanityClient\$1" dist/index.d.ts`
returns 0 for that exact spelling, while the graph is clearly rooted somewhere
(`dist/index.d.ts:1856`, `:2004` and others reference a `SanityClient$1` alias
in inlined declarations). So Step 1 is to find the real root rather than trust
the claim.

**The export in question** — `src/index.ts:17-21` exports `assignmentDocId`,
`useAssignmentStore` and `type AssignmentStore`. None appears in `README.md`
(`grep -c` returns 0 for each).

**Repo conventions that apply here**:
- `package.json`'s `inlinedDependencies` field lists what the build inlines. Note `plans/README.md` already records that its `get-it` entry is stale metadata — do not be misled by that entry.
- `src/link-checker.ts` is the model of a clean entry point: 122 published lines, because it keeps its imports external.

## Commands you will need

| Purpose   | Command                               | Expected on success |
|-----------|---------------------------------------|---------------------|
| Build     | `npm run build`                       | `[success]`         |
| Measure   | `wc -l dist/index.d.ts`               | a number to compare |
| Globals   | `grep -c "declare global" dist/index.d.ts` | a number to compare |
| Typecheck | `npm run typecheck`                   | exit 0, no output   |
| Tests     | `npm test`                            | all pass            |

## Scope

**In scope:**
- `src/inbox/sources/assignmentStore.ts` — the exported signature, if Step 1 confirms it is the root
- `src/index.ts` — only if a different export turns out to be the root
- `package.json` — only if the chosen fix is the dependency route (Step 2, option B)

**Out of scope** (do NOT touch, even though they look related):
- **Removing `useAssignmentStore`, `assignmentDocId` or `AssignmentStore` from the barrel.** That is semver-major. Plan 083 stages that decision. This plan keeps them exported and makes them cheap.
- The internal use of the real `SanityClient` type inside `assignmentStore.ts`'s own implementation. Only the *exported signature* needs narrowing.
- `inlinedDependencies.get-it` (known stale metadata, recorded separately).

## Git workflow

- Branch: `advisor/071-type-surface`
- Conventional Commits: `fix:` or `perf:`. If the signature narrowing is judged breaking, `fix!:` with a `BREAKING CHANGE:` footer — see STOP conditions.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Find the actual root of the inlined graph

Do not assume. Establish it:

1. `npm run build` to get a current `dist/index.d.ts`.
2. Find which *exported* declaration first references a client type. Useful
   probes:
   ```
   grep -n "SanityClient" dist/index.d.ts | grep "declare function\|declare const\|: SanityClient"
   grep -n "useAssignmentStore\|assignmentDocId\|AssignmentStore" dist/index.d.ts
   ```
3. For each candidate root, note the symbol and the exact alias spelling used
   (`SanityClient`, `SanityClient$1`, …).

Record in your report: **the list of exported symbols whose declarations
reference a `@sanity/client` type**, with line numbers. That list is what the
fix has to address, and it may be one symbol or several.

**Verify**: your report names at least one concrete root with a line number.

### Step 2: Narrow the exported signature(s)

Preferred fix — replace the client type in the *exported* signature with a
local structural minimum, so the published declaration stops reaching into
`@sanity/client`:

```ts
/**
 * The parts of a Sanity client this store actually uses.
 *
 * Declared structurally rather than as `SanityClient` on purpose: this hook is
 * exported from the package barrel, and naming the real type there made the
 * build inline ~10,000 lines of `@sanity/client` declarations — plus three
 * `declare global` blocks, one of which re-declares TypeGen's own
 * `SanityQueries` interface — into every consumer's type graph.
 */
export interface AssignmentStoreClient {
  fetch: SanityClient['fetch']
  // ...only what is used; read the implementation and list them
}
```

Careful: referencing `SanityClient['fetch']` still names the type. If the
indexed access is enough to pull the graph back in, declare the methods
explicitly instead (e.g. `fetch(query: string, params?: Record<string, unknown>): Promise<unknown>`).
Measure after each attempt — the measurement is the verification, not your
expectation.

If narrowing proves impossible, the alternative (option B) is to declare
`@sanity/client` a real dependency or peer so `pkg-utils` emits an external
`import type` instead of inlining. That is a smaller code diff but adds a
manifest entry and interacts with `inlinedDependencies` — and per
`AGENTS.md`'s peer-floor section, any Sanity-scoped dependency range must be
satisfiable across the whole peer range, so plan 061's rule applies. Prefer
option A.

**Verify** after the change:
```
npm run build
wc -l dist/index.d.ts
grep -c "declare global" dist/index.d.ts
grep -c "interface SanityQueries" dist/index.d.ts
```
Target: `dist/index.d.ts` well under ~2,000 lines, `declare global` count 0,
`SanityQueries` count 0. Record the before and after numbers.

### Step 3: Confirm nothing real broke

Internal callers pass a full `SanityClient`, which structurally satisfies a
narrower interface, so they should compile unchanged.

**Verify**: `npm run typecheck` → exit 0. `npm test` → all pass.
`grep -rn "useAssignmentStore" src/ | grep -v test` → every call site still
compiles (the typecheck covers this; list them in your report).

### Step 4: Record the measurement as the guard

Add to `AGENTS.md`, alongside the peer-floor section:

> The published type surface is measured, not assumed: `dist/index.d.ts` is a
> few hundred lines. If it jumps to five figures, an exported signature has
> started naming a type from an inlined dependency (`@sanity/client` is the
> one that bites), which drags that whole graph — and its `declare global`
> blocks, including a re-declaration of TypeGen's `SanityQueries` — into every
> consumer. Check `wc -l dist/index.d.ts` and `grep -c "declare global" dist/index.d.ts`.

**Verify**: `grep -c "declare global" AGENTS.md` → at least 1.

## Test plan

No unit tests — this is a build-output property. The verification **is** the
measurement, and it should be recorded in the PR description:

| | before | after |
|---|---|---|
| `wc -l dist/index.d.ts` | 11380 | ? |
| `grep -c "declare global"` | 3 | ? |
| `grep -c "interface SanityQueries"` | 5 | ? |

`npm test` must pass unchanged (this plan touches no runtime behaviour).

## Done criteria

ALL must hold:

- [ ] Step 1's root list is recorded with line numbers
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `wc -l dist/index.d.ts` is under 2,000
- [ ] `grep -c "declare global" dist/index.d.ts` → 0
- [ ] `grep -c "interface SanityQueries" dist/index.d.ts` → 0
- [ ] `npm run typecheck` exits 0; `npm test` exits 0
- [ ] No export was removed or renamed (`git diff src/index.ts` shows no deletions)
- [ ] The before/after table is in your report
- [ ] `AGENTS.md` carries the Step 4 note
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds the root is **not** in `assignmentStore.ts` but in a symbol that
  cannot be narrowed without a genuinely breaking change (e.g. a `@public`
  type integrators are documented to use). Report which symbol; the decision
  is the maintainer's.
- The narrowing works but `dist/index.d.ts` stays above ~5,000 lines. Then
  there is a second root — go back to Step 1 rather than declaring partial
  victory.
- Option A is impossible and option B requires widening a Sanity-scoped
  dependency range. That collides with plan 061's rule; both plans need to be
  considered together.
- Removing the `SanityQueries` global turns out to be impossible while
  `@sanity/client` is inlined at all. That is the most important half of this
  plan (it can break a consumer's TypeGen), so say so loudly rather than
  shipping the line-count win alone.

## Maintenance notes

- A reviewer should ask for the before/after numbers. "It builds" is not
  evidence for this plan.
- Plan 067 (API report) makes this diffable going forward; plan 083 decides
  whether these three symbols should be published at all. This plan
  deliberately does neither — it makes the current surface cheap without
  changing what it contains.
- The `SymbolConstructor.observable` and `interface File {}` globals come from
  rxjs and the client's upload types respectively. If they survive the fix,
  note it: they are less dangerous than `SanityQueries` but still pollution.
