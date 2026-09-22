# Plan 073: Test the things that spend the integrator's money

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/ai/ src/structure/resolveConfig.ts src/inbox/sources/unpublishedDrafts.ts src/inbox/sources/linkCheckerFindings.ts`
> On any mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — tests only.
- **Depends on**: none. (Plan 064 changes `linkCheckerFindings.proposeFix`; if both run, do 064 first — its tests overlap Step 4 here.)
- **Category**: tests
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Everything tested in `src/ai/` is pure. Everything that **spends money** is
not. Specifically:

- `useAgentClient` is the single gate for every paid call in the plugin, and it
  has **no test file**. It owns two guards: `enabled: false` → `undefined`, and
  a missing `client.agent.action.prompt` → `warnOnce` + `undefined`.
- The documented `ai?: boolean` opt-out is implemented entirely by passing that
  flag through (`unpublishedDrafts.ts:282`). Nothing constructs
  `unpublishedDrafts({ai: false})` and asserts `assess`/`suggestSnooze` come
  back `undefined`.
- `resolveConfig` sets the plugin-level cost defaults (`ask ?? false`,
  `summarize ?? true`, `suggestTodos ?? true`) and is untested.
  `Inbox.test.tsx:344-371` tests the *component's* prop defaults, not this
  function.
- `promptJson()` — the one function that actually calls
  `client.agent.action.prompt` — is never executed by any test.
  `promptJson.test.ts` imports only `parseJsonResponse`, and both integration
  suites `vi.mock('../ai/promptJson')`.
- `instantOnly` is the protocol that stops a bulk fix billing per row. It is
  verified on `assetIssues` and **not** on `linkCheckerFindings`, the only
  other `proposeFix` implementor.

An integrator's only way to stop per-click Agent Actions spend is a boolean
whose enforcement path is unverified. A regression that ignores it bills the
customer silently.

## Current state

- `src/ai/useAgentClient.ts:30-47` — the gate; no sibling test file.
- `src/inbox/sources/unpublishedDrafts.ts:47-58` — the `ai` option's own doc comment: "every press spends an Agent Actions request, and a Studio should be able to turn that off". Enforced at `:282` via `useAgentClient({enabled: ai})`.
- `src/structure/resolveConfig.ts:14-16` — the three cost defaults.
- `src/ai/promptJson.ts:93-105` — the paid call; `:102` casts `instructionParams`; the `extra` spread is untested.
- `src/inbox/sources/unpublishedDrafts.ts:327` passes `{localeSettings: {locale, timeZone}}` through that untested spread.
- `src/inbox/sources/linkCheckerFindings.ts:618-632` — `if (fixOptions?.instantOnly) return null` before the paid branch at `:640`. `linkCheckerFindings.test.ts` (343 lines) never calls `proposeFix`.
- The good example to copy: `src/inbox/sources/assetIssues.proposeFix.test.tsx:180` — "never calls describeImage under instantOnly".

**Conventions**: `vi.mock('sanity')` with a stubbed `useClient` — the pattern
at `src/store/useDismissals.test.tsx:44-53` is directly reusable.
`warnOnce` dedupes for the process lifetime, so call `resetWarnings()`
(`src/warnOnce.ts`) in `beforeEach` as `src/structure/wrapStructure.test.ts:11`
does.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| AI suites | `npx vitest run src/ai/` | all pass |
| Full tests | `npm test` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope (all new or extended test files):**
- `src/ai/useAgentClient.test.ts` (create)
- `src/ai/promptJson.test.ts` (extend)
- `src/structure/resolveConfig.test.ts` (create)
- `src/inbox/sources/unpublishedDrafts.test.ts` (extend)
- `src/inbox/sources/linkCheckerFindings.proposeFix.test.tsx` (create)

**Out of scope:** every implementation file. If a test reveals a bug, report
it — do not fix it here.

## Git workflow

- Branch: `advisor/073-ai-cost-gate-tests`
- Conventional Commits: `test:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: `useAgentClient` — three tests

1. `enabled: false` → returns `undefined`.
2. `enabled: true` and a client whose `agent.action.prompt` is a function →
   returns a client, and `withConfig({apiVersion: ...})` was applied (assert
   the exact apiVersion the implementation uses — read it, do not guess).
3. `enabled: true` but `client.agent?.action?.prompt` is not a function →
   returns `undefined` **and** `warnOnce` fired (spy on `console.warn`, with
   `resetWarnings()` in `beforeEach`).

**Verify**: `npx vitest run src/ai/useAgentClient.test.ts` → 3 pass.

### Step 2: `resolveConfig` — the cost defaults

Assert `ask` defaults to `false` and `summarize`/`suggestTodos` default to
`true`, and that each explicit value is respected. `ask` defaulting to `false`
is the one that bills on a click, so name that test so it is obvious.

**Verify**: `npx vitest run src/structure/resolveConfig.test.ts` → pass.

### Step 3: `promptJson` itself

With a stub client whose `agent.action.prompt` is a `vi.fn()`:

1. Assert the **exact argument object**: the instruction string,
   `instructionParams`, and the spread `extra` (e.g. `localeSettings`) all
   arrive. A dropped `localeSettings` is what makes every snooze suggestion
   resolve in UTC.
2. A prose (non-JSON) answer → `promptJson` resolves `null`.
3. A **rejecting** `prompt` → `promptJson` rejects (the documented contract at
   `promptJson.ts:83-85`), rather than swallowing to `null`. That distinction
   decides whether the editor sees an error or silence.

**Verify**: `npx vitest run src/ai/promptJson.test.ts` → existing plus 3 new.

### Step 4: `instantOnly` on the second `proposeFix` implementor

New file `src/inbox/sources/linkCheckerFindings.proposeFix.test.tsx`, modelled
on `assetIssues.proposeFix.test.tsx`:

1. A **link** finding fixes under `instantOnly` (the free path still works).
2. A **reference** finding returns `null` under `instantOnly` **and the agent
   client is never called**. Assert on the stub's call count — that is the
   assertion protecting against a 200-row bulk click becoming 200 billed calls.
3. On an explicit (non-bulk) click, it prompts exactly once and the returned
   `apply()` patches only the one field.

**Verify**: `npx vitest run src/inbox/sources/linkCheckerFindings.proposeFix.test.tsx` → 3 pass.

### Step 5: The `ai: false` opt-out, end to end

Extend `unpublishedDrafts.test.ts`: `renderHook` on
`unpublishedDrafts({ai: false}).useItems()` with the stubbed client, and assert
`result.current.assess` and `result.current.suggestSnooze` are both
`undefined`. Then the same with `ai` unset, asserting they are defined.

**Verify**: `npx vitest run src/inbox/sources/unpublishedDrafts.test.ts` → pass.

## Test plan

Summarised above: 3 + ~4 + 3 + 3 + 2 ≈ 15 new tests across five files.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] `src/ai/useAgentClient.test.ts` and `src/structure/resolveConfig.test.ts` exist
- [ ] `grep -c "promptJson(" src/ai/promptJson.test.ts` → at least 1 (the function itself, not only its parser, is now executed)
- [ ] `src/inbox/sources/linkCheckerFindings.proposeFix.test.tsx` exists and asserts the agent client is not called under `instantOnly`
- [ ] `unpublishedDrafts.test.ts` asserts `assess`/`suggestSnooze` are `undefined` when `ai: false`
- [ ] `git status` shows only test files added/changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any assertion fails against current behaviour — especially Step 4's
  "never called under `instantOnly`". Report it; a failure there is the single
  most expensive bug shape in this repo, not a test to relax.
- `promptJson` cannot be tested without mocking more of `sanity` than
  `useClient`. Report what it needs rather than mocking the module under test.
- Testing `useAgentClient` requires a full Studio context. Check whether
  `useSafely`/`optionalHook` (`src/inbox/sources/capability.ts`) already make
  it degrade without one; if it genuinely needs a provider, say so.

## Maintenance notes

- The rule: **a code path that bills the integrator gets a test asserting it
  does not fire.** The pure parsers were tested because they were easy; the
  gates matter more.
- A reviewer should look for Step 4's call-count assertion specifically.
- Deferred: double-click guards on the paid handlers are plan 066; this plan
  covers whether the calls happen at all, not how many times a click fires.
