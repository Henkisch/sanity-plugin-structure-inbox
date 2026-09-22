# Plan 064: Never write a reference the model invented

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/sources/linkCheckerFindings.ts src/inbox/sources/linkCheckerFindings.test.ts src/ai/askInbox.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — the change strictly narrows what can be written. The worst outcome is that a proposal which would previously have been offered now returns `null`.
- **Depends on**: none
- **Category**: bug (data integrity on an AI write path)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`linkCheckerFindings` reports broken references. It also offers to fix one: it
asks a model to pick, from a list of candidate documents, the one a dangling
reference should now point to — and then writes that choice into the document
as a strong reference.

The model's answer is never checked against the candidate list. The only guard
is a truthiness test. So a model that returns an `_id` that does not exist —
invented, or remembered from a stale context — gets that value written straight
into real content as `{_type: 'reference', _ref: <whatever it said>}`.

The feature can therefore **create exactly the dangling reference the source
exists to report**. The row will reappear on the next scan, now pointing at
something that never existed, and the editor has been billed an Agent Actions
call for the privilege.

There is a second, narrower hole in the same three lines: `FixChoice.id` is
*typed* `string | null` but is unvalidated JSON from a model. `if (!choice?.id)`
passes for `{"id": 123}` and for `{"id": {...}}`, and either reaches `.set()`
as a non-string `_ref` — producing a rejected mutation or a malformed document.

This repo already knows how to do this properly, in a sibling AI path.
`selectionFromResponse` in `src/ai/askInbox.ts` validates every model-returned
key against the rows that actually exist and drops anything else, with the
reasoning stated in its own doc comment: a model will eventually invent a
plausible-looking key. That is the discipline missing here.

## Current state

`src/inbox/sources/linkCheckerFindings.ts:640-675` — the prompt, the
unvalidated answer, and the write:

```ts
const choice = await promptJson<FixChoice>(
  agentClient,
  "Given the following document:\n$document\n---\nField '" +
    finding.fieldPath +
    "' should hold a reference to a " +
    targetType +
    ' document, but the one it pointed to no longer exists. Here are the ' +
    targetType +
    ' documents that currently exist:\n$candidates\n---\n' +
    'Return JSON {"id": string or null, ...}',
  {
    document: {type: 'document', documentId: finding.fromId},
    candidates: {
      type: 'groq',
      query: '*[_type == $type][0...20]{_id, "label": coalesce(title, name, _id)}',
      params: {type: targetType},
    },
  },
)

if (!choice?.id) return null

const chosenId = choice.id
return {
  summary: choice.reason ? `Replace with "${choice.label}" — ${choice.reason}` : `Replace with "${choice.label}"`,
  apply: async () => {
    await client
      .patch(finding.fromId)
      .set({[finding.fieldPath]: {_type: 'reference', _ref: chosenId}})
      .commit()
  },
}
```

Note that the candidate list exists **only inside the prompt**, as a
`$candidates` GROQ parameter resolved by Agent Actions. The plugin's own code
never holds those ids, so there is currently nothing to validate against —
which is why fixing this needs one extra fetch, not just an `if`.

**The in-repo precedent to match** — `src/ai/askInbox.ts:53-71`:

```ts
export function selectionFromResponse(raw: unknown, rows: readonly MergedRow[]): AskInboxSelection | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (!('keys' in raw) || !Array.isArray(raw.keys)) return null

  const validKeys = new Set(rows.map((row) => row.key))
  const seen = new Set<string>()
  const keys: string[] = []

  for (const key of raw.keys) {
    if (typeof key !== 'string') continue
    if (!validKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  ...
```

Two properties worth copying exactly: it takes `raw: unknown` rather than a
trusted generic, and it *drops* what does not validate rather than throwing.

**Repo conventions that apply here**:
- AI parsers live as pure, separately-testable functions (`parseAssessment`, `parseSnoozeSuggestion`, `selectionFromResponse`) and are exported for their own tests. Match that: the validation should be a pure function you can unit-test without a client.
- `proposeFix` returning `null` is a normal, expected outcome meaning "no proposal" — every caller handles it. Returning `null` is always preferable to writing a guess.

## Commands you will need

| Purpose   | Command                                                        | Expected on success |
|-----------|----------------------------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                                            | exit 0, no output   |
| Lint      | `npm run lint`                                                  | exit 0, no output   |
| This file's tests | `npx vitest run src/inbox/sources/linkCheckerFindings.test.ts` | all pass |
| Full tests | `npm test`                                                     | all pass            |
| Build     | `npm run build`                                                 | `[success]`         |

## Scope

**In scope:**
- `src/inbox/sources/linkCheckerFindings.ts`
- `src/inbox/sources/linkCheckerFindings.test.ts` — new tests

**Out of scope** (do NOT touch, even though they look related):
- `src/ai/askInbox.ts` — it is the model for this change and is already correct.
- `src/ai/promptJson.ts` — its job is transport and JSON extraction, not domain validation. A separate finding covers its brace-scanning (plan 080); do not fold that in here.
- The prompt text itself, beyond what Step 2 requires. Rewording it is not what makes this safe; validating the answer is.
- `assetIssues.ts`'s `proposeFix` — a different fix path, already re-reads before writing.

## Git workflow

- Branch: `advisor/064-validate-model-reference`
- Conventional Commits. This is a `fix:`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a pure validator for the model's answer

Add an exported function to `src/inbox/sources/linkCheckerFindings.ts`,
modelled on `selectionFromResponse`:

```ts
/**
 * The id a model picked, but only if it is genuinely one of the candidates we
 * offered it.
 *
 * `FixChoice` is *typed* `{id: string | null}` but is unvalidated JSON from a
 * model, so `id` can be a number, an object, or an `_id` that does not exist
 * at all. Writing an unchecked value here would make this fix create the very
 * dangling reference the source reports — so an id that is not a string, or
 * not in `candidateIds`, is dropped rather than trusted. Same posture as
 * `selectionFromResponse` in `src/ai/askInbox.ts`, and for the same stated
 * reason: a model will eventually invent a plausible-looking id.
 */
export function validateChosenReference(
  raw: unknown,
  candidateIds: ReadonlySet<string>,
): {id: string; label: string; reason: string} | null
```

Rules, all of them necessary:
- `raw` must be a non-null object.
- `raw.id` must be `typeof === 'string'` and non-empty after trimming.
- `raw.id` must be in `candidateIds`.
- `label` and `reason` are used only in display text, so coerce them safely:
  a non-string becomes `''` (do not reject the whole choice over a bad label).
- Anything else → `null`.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Fetch the candidate ids in code, and validate against them

The plugin currently never sees the candidate list. Fetch it with the **same
query and params** the prompt uses, so the set validated against is the set the
model was shown:

```ts
const CANDIDATES_QUERY = '*[_type == $type][0...20]{_id, "label": coalesce(title, name, _id)}'
```

Hoist that string to module scope and use the one constant in both places —
the prompt's `$candidates` parameter and the new fetch. If the two ever drift,
the validation starts rejecting valid answers, so sharing the constant is the
point.

Then:

```ts
const candidates = await client.fetch<{_id: string; label?: string}[]>(CANDIDATES_QUERY, {type: targetType})
const candidateIds = new Set(candidates.map((row) => row._id))

const choice = await promptJson<unknown>(agentClient, /* ...unchanged... */)

const validated = validateChosenReference(choice, candidateIds)
if (!validated) return null

return {
  summary: validated.reason
    ? `Replace with "${validated.label}" — ${validated.reason}`
    : `Replace with "${validated.label}"`,
  apply: async () => {
    await client
      .patch(finding.fromId)
      .set({[finding.fieldPath]: {_type: 'reference', _ref: validated.id}})
      .commit()
  },
}
```

Note `promptJson<unknown>` rather than `promptJson<FixChoice>` — the generic was
asserting a shape nobody had checked. If `FixChoice` becomes unused, remove it;
if it is used elsewhere, leave it.

Order matters: fetch the candidates **before** the `promptJson` call. If the
fetch fails there is no point spending an Agent Actions request, and this way a
failed fetch costs nothing.

**Verify**: `npx vitest run src/inbox/sources/linkCheckerFindings.test.ts` →
all pass.

### Step 3: Confirm the write cannot be reached with an unvalidated value

**Verify**: `grep -n "_ref:" src/inbox/sources/linkCheckerFindings.ts` — every
hit must use `validated.id` (or another provably-checked value), never
`choice.id` or a raw model field. List the hits in your report.

## Test plan

New tests. The validator is pure, so most of this needs no client — put those
in `src/inbox/sources/linkCheckerFindings.test.ts` alongside the existing
`toItems`/grouping tests.

`validateChosenReference` cases:

1. A valid id that is in the candidate set → returns it.
2. An id **not** in the candidate set → `null`. *This is the regression this plan exists for.* Name the test so that is obvious.
3. `{"id": 123}` → `null` (non-string).
4. `{"id": {"_ref": "x"}}` → `null` (object).
5. `{"id": null}` → `null`.
6. `{"id": "  "}` → `null` (empty after trim).
7. `raw` is `null` / a string / an array → `null` for each.
8. A valid id with a non-string `label` → still returns, with `label: ''`.

Plus one integration-shaped test for the fix path, modelled on
`src/inbox/sources/assetIssues.proposeFix.test.tsx` (which is the house pattern
for testing a `proposeFix` under a stub client):

9. Given a reference finding, a stub client whose candidates fetch returns
   ids `['a','b']`, and a stubbed agent client answering `{"id": "zzz"}`:
   `proposeFix` returns `null` and **no `patch` is committed**. Assert on the
   client stub's `patch` never having been called — that is the assertion that
   proves content cannot be corrupted.

**Verify**: `npm test` → all pass, with 9 new tests.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 9 new tests
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `grep -n "choice.id" src/inbox/sources/linkCheckerFindings.ts` returns no matches (the unvalidated path is gone)
- [ ] `grep -c "CANDIDATES_QUERY" src/inbox/sources/linkCheckerFindings.ts` → at least 2 (the prompt parameter and the fetch share one constant)
- [ ] Your report lists every `_ref:` write site and the checked value it uses
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The prompt's `$candidates` parameter cannot be made to share one query
  constant with the fetch (e.g. Agent Actions requires a different query
  shape). Validating against a *different* set than the model saw would
  produce false rejections, which is a worse failure than the current one —
  report instead of shipping that.
- The candidate fetch turns out to need permissions the plugin does not have
  in some studios. Then the honest fix is to return `null` (offer no proposal)
  rather than to skip validation; confirm that is acceptable before doing it.
- You find another AI path in this repo that writes a model-supplied value
  without validating it. Report it — it belongs in its own plan, not folded in
  here.

## Maintenance notes

- The rule this establishes: **a model-supplied identifier is never written
  without being checked against a set the code itself fetched.** Two paths now
  follow it (`askInbox`, this one). Any third AI write path should too, and a
  reviewer should ask for it explicitly.
- A reviewer should scrutinise: that the fetch happens before the paid call
  (otherwise a fetch failure wastes money), and that the two uses of
  `CANDIDATES_QUERY` really are the same string.
- Deferred out of this plan: the `[0...20]` candidate cap means a correct
  answer outside the first twenty candidates cannot be offered. That is a
  pre-existing product limit, not made worse here, and changing it affects
  prompt size and cost.
