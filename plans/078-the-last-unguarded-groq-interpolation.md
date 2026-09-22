# Plan 078: Guard the third GROQ field-name interpolation, the one plan 039 missed

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/projectDigest.ts src/inbox/projectDigest.test.ts src/inbox/sources/assetIssues.ts src/inbox/sources/linkCheckerFindings.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — a rejected field name means one type contributes no samples, a case the caller already handles.
- **Depends on**: none
- **Category**: security (defensive consistency)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

This repo decided it wants an allow-list guard on every GROQ field-name
interpolation. Plan 039 implemented it in `assetIssues.ts`;
`linkCheckerFindings.ts` has it too. `projectDigest.ts` does not, and it is the
third site.

The value comes from the integrator's own schema (`defineField({name: …})` is
just a string), so this is not attacker-reachable — which is why it is P2 and
not P1. But a field name carrying GROQ syntax changes the shape of a
dataset-wide query **whose result is then placed verbatim into an AI prompt**.
That can widen the projection to fields the digest was never meant to carry, or
simply fail the query and take the whole "Ask" / "Find content gaps" read down.

Same defensive boundary, same repo, two of three sites. Finish it.

## Current state

`src/inbox/projectDigest.ts:149-156` — the unguarded interpolation:

```ts
const sampleField = count > 0 ? findSampleFieldName(schema, name) : undefined
if (sampleField) {
  const windowLimit = Math.min(count, SAMPLE_WINDOW_SIZE)
  const raw = await client.fetch<(string | null)[]>(
    `*[_type == $type] | order(_updatedAt desc)[0...$limit].${sampleField}`,
    {type: name, limit: windowLimit},
  )
```

`grep -c "SIMPLE_FIELD_PATH" src/inbox/projectDigest.ts` → **0**.

**The guard, defined twice already**:
- `src/inbox/sources/assetIssues.ts:28` — `const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/`, with a doc comment explaining it is "the only shape safe to interpolate directly into a GROQ query string"
- `src/inbox/sources/linkCheckerFindings.ts:94` — a second copy

`assetIssues.ts:581-585` goes further and **hard-fails** an integrator-supplied
`altFieldName` that does not match. That is the right posture for a value the
integrator passes explicitly; for a value read from the schema, skipping the
field is better than throwing (see Step 2).

**The caller already handles a missing field**: `surveyContentTypes` treats
`sampleField === undefined` as "no samples for this type".

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| This suite | `npx vitest run src/inbox/projectDigest.test.ts` | all pass |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/inbox/projectDigest.ts`, `src/inbox/projectDigest.test.ts`,
and a new shared module for the pattern (Step 1)

**Out of scope:**
- `assetIssues.ts:581-585`'s hard-fail on `altFieldName` — different value, different posture, correct as is.
- Which field `findSampleFieldName` picks. That is plan 086's question (it is a privacy decision, not a safety one).

## Git workflow

- Branch: `advisor/078-groq-guard`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Hoist the pattern into one module

Two copies already exist. Adding a third is the wrong move. Create
`src/inbox/sources/simpleFieldPath.ts` (or place it beside `liveQuery.ts` —
match wherever the repo keeps small shared source helpers) and export:

```ts
/**
 * A plain field name — no `[index]`, no `.nested`, no `->`. The only shape
 * that is safe to interpolate directly into a GROQ query string.
 *
 * Every site that splices a field name into query text must gate on this.
 * There were three such sites and this pattern was copied into two of them;
 * the third (`projectDigest.ts`) went unguarded, which is why it now lives
 * in one place.
 */
export const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/
```

Then have `assetIssues.ts` and `linkCheckerFindings.ts` import it instead of
declaring their own. Do not change their behaviour.

**Verify**: `grep -rn "SIMPLE_FIELD_PATH = " src/` → exactly one definition.
`npm test` → all pass.

### Step 2: Gate `findSampleFieldName`

Make `findSampleFieldName` return `undefined` for any name that fails the
pattern, so the unsafe value never reaches the query:

```ts
// Skip rather than throw: this name comes from the integrator's own schema,
// and one odd field name should cost that type its samples, not take the
// whole project survey down. `surveyContentTypes` already treats `undefined`
// as "no samples for this type".
if (!SIMPLE_FIELD_PATH.test(fieldName)) return undefined
```

**Verify**: `npx vitest run src/inbox/projectDigest.test.ts` → all pass.

### Step 3: Confirm there is no fourth site

**Verify**: search for template-literal interpolation into query strings:
```
grep -rn '\${' src/ --include=*.ts --include=*.tsx | grep -i "type ==\|order(\|\*\[" | grep -v test
```
List every hit in your report with a verdict: guarded, or a literal constant
(not integrator data), or a new finding.

## Test plan

In `src/inbox/projectDigest.test.ts`:

1. A hostile field name (e.g. one containing `}`, `->`, or a space) → the
   survey produces no samples for that type and **no interpolation happens**.
   Assert the client's `fetch` was not called with that name.
2. A normal field name still produces samples (the happy path is unchanged).
3. A type with `count === 0` still short-circuits before any field lookup.

**Verify**: `npm test` → all pass, 3 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] `grep -rn "SIMPLE_FIELD_PATH = " src/` → exactly one definition
- [ ] `grep -c "SIMPLE_FIELD_PATH" src/inbox/projectDigest.ts` → at least 1
- [ ] Test 1 was confirmed to fail before the change
- [ ] Step 3's interpolation-site inventory is in your report, with a verdict each
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Consolidating the two existing copies changes any existing test. The
  consolidation must be behaviour-preserving; if it is not, leave them alone,
  add the guard locally in `projectDigest.ts`, and report.
- Step 3 finds a fourth unguarded site. Report it as a separate finding rather
  than expanding scope.
- The pattern turns out to reject field names real schemas use (e.g. names with
  a hyphen). Report before loosening it — a looser pattern needs its own
  reasoning, and both existing sites would inherit it.

## Maintenance notes

- One definition now. A new site that splices a field name into GROQ must
  import it — worth a line in `AGENTS.md` if a fourth site ever appears.
- A reviewer should check the guard **skips** rather than throws here, and that
  `assetIssues`' explicit-option hard-fail was left as is. The two postures are
  deliberate and different.
