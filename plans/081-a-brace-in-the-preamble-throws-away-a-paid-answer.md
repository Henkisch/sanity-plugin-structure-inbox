# Plan 081: Try every JSON candidate in a model answer, not just the first

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/ai/promptJson.ts src/ai/promptJson.test.ts`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — strictly more answers parse. Existing tests should all still pass.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`extractBalanced` takes `raw.search(/[{[]/)` — the **first** `{` or `[` in the
string — and if that one candidate does not parse, `parseJsonResponse` returns
`null`. There is no scan to the next candidate.

So a model answer like:

> I'll return a JSON object with the keys {id, label, reason}: {"id": "abc", …}

extracts the decoy `{id, label, reason}`, fails `JSON.parse`, and returns
`null`. Every caller treats `null` as "the model did not cooperate"
(`unpublishedDrafts.ts:301` throws `AssessmentUnavailableError`,
`linkCheckerFindings.ts:664` offers no proposal).

The Agent Actions call has already been billed. So this is money spent for a
discarded result, and to the editor it looks like an unreliable feature.

The doc comment at `:43-55` claims robustness to "a leading 'Here you go:'" —
which holds only while that prefix contains no brace.

## Current state

`src/ai/promptJson.ts:10-41` — `extractBalanced`, starting from
`raw.search(/[{[]/)`.

`src/ai/promptJson.ts:58-66` — returns `null` when that single candidate fails.

`src/ai/promptJson.ts:43-55` — the doc comment whose claim is narrower than it
reads.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| This suite | `npx vitest run src/ai/promptJson.test.ts` | all pass |
| Full tests | `npm test` | all pass |

## Scope

**In scope:** `src/ai/promptJson.ts`, `src/ai/promptJson.test.ts`

**Out of scope:**
- The callers' handling of `null` — unchanged and correct.
- Domain validation of the parsed object. `promptJson`'s job is transport and extraction; validating the *content* is the caller's (plan 064 does that for `linkCheckerFindings`). Do not add schema checks here.
- Making a second paid call on a parse failure. Never; that doubles the cost of the exact case this plan makes cheaper.

## Git workflow

- Branch: `advisor/081-json-candidates`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Scan candidates until one parses

Turn the single `search` into a loop over successive candidate positions:

```ts
/**
 * Every `{`/`[` in the answer, tried in order, until one yields a balanced
 * slice that `JSON.parse` accepts.
 *
 * A single candidate was not enough: a model that names its keys in prose
 * before answering ("...with the keys {id, label, reason}: {…real JSON…}")
 * puts a decoy first, and the real payload was thrown away — along with the
 * Agent Actions request that had already been billed for it.
 */
```

Implementation shape:

```ts
for (let from = 0; from < raw.length; from += 1) {
  const start = raw.slice(from).search(/[{[]/)
  if (start === -1) return null
  const at = from + start
  const slice = extractBalanced(raw, at)
  if (slice) {
    try {
      return JSON.parse(slice) as unknown
    } catch {
      // fall through to the next candidate
    }
  }
  from = at // continue scanning after this candidate's opening brace
}
return null
```

Two things to be careful about:

1. **Termination.** `from` must advance past the candidate on every iteration,
   or this loops forever on a string with one brace. Write the loop so that is
   structurally guaranteed, and say in your report why it terminates.
2. **Cost.** A pathological answer with many braces makes this quadratic.
   Bound the number of candidates tried (e.g. 20) and return `null` past that —
   a model answer with twenty brace-openings before the payload is not a case
   worth optimising for.

Refactor `extractBalanced` to take a start index if it does not already.

**Verify**: `npx vitest run src/ai/promptJson.test.ts` → all existing tests
still pass (this is the signal that the refactor is behaviour-preserving for
the cases already covered).

### Step 2: Correct the doc comment

`:43-55` claims robustness it did not have. After Step 1 it does — state the
new behaviour and its bound (the candidate cap) so the next reader knows the
limit.

**Verify**: `grep -n "Here you go" src/ai/promptJson.ts` → the comment now
describes candidate scanning.

## Test plan

In `src/ai/promptJson.test.ts` (it already tests `parseJsonResponse` — add
alongside):

1. **The regression**: an answer with a brace-containing preamble followed by
   real JSON parses to the real payload. Fails before this plan.
2. An answer whose first candidate is a *valid but wrong* JSON object still
   returns the first one — this plan must not start preferring later
   candidates. (Document that as intended: first-valid wins.)
3. A pure-prose answer still returns `null`.
4. An answer with an unterminated brace then valid JSON parses the valid one.
5. An answer with more than the candidate cap of braces before the payload
   returns `null` (the bound is deliberate, so assert it).
6. An array payload (`[...]`) still works.

**Verify**: `npm test` → all pass, 6 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Test 1 was confirmed to fail before the change
- [ ] Your report states why the loop terminates and what the candidate cap is
- [ ] All pre-existing `promptJson.test.ts` tests pass unchanged
- [ ] `git status` shows only the two in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- The loop cannot be shown to terminate on some input. Do not ship it —
  an infinite loop here runs inside a click handler.
- Any existing test changes behaviour. The refactor should be additive for
  already-covered cases; if it is not, report which case changed and why.
- You find yourself wanting to retry the model call on a parse failure. Do not:
  that is a second charge for the same question.

## Maintenance notes

- First-valid-candidate-wins is the rule, and test 2 pins it. Preferring the
  *last* candidate would be equally defensible in the abstract but would change
  behaviour for answers that trail commentary after the payload.
- A reviewer should check the termination argument and the cap — those are the
  two ways this change could be worse than the bug.
- Plan 073 adds the first tests that execute `promptJson` itself (as opposed to
  its parser). If both run, that plan's stub client makes case 3 here easier to
  assert end to end.
