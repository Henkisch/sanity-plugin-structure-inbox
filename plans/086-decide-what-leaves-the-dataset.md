# Plan 086: Decide — and document — which field values leave the dataset on an AI read

> **Executor instructions**: This is a **design plan**, not a build plan. Its
> output is a decision, a short written rationale, and only then whatever code
> the decision implies. Do not implement an API before Step 3 has an answer
> from the maintainer.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/projectDigest.ts src/ai/askInbox.ts README.md`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2 (as a decision; the code that follows may be S or M)
- **Effort**: S to investigate and document; M if an opt-out API is chosen
- **Risk**: MED — narrowing what is sampled weakens the digest, which is the whole point of plan 042. This is a product trade-off, not a pure bug fix.
- **Depends on**: none. Related to plan 078, which guards the same interpolation for *safety* rather than privacy.
- **Category**: direction / security (data minimisation)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`findSampleFieldName` picks **the first field whose `jsonType === 'string'`**,
with no notion of sensitivity. The survey then fetches up to
`SAMPLE_WINDOW_SIZE` (100) values of it per type, keeps 5, and inlines them —
plus each type's schema `description` — into the prompt text, for up to
`MAX_SURVEYED_TYPES` (30) types.

So one click on Ask or Find content gaps can send **up to 150 real field
values** to Sanity's Agent Actions. On a schema where the first string field of
a type happens to be an email, a phone number, an address or an internal note —
a `person`, `lead` or `submission` type — those are the values that leave.

Nothing in the UI tells the editor which fields will leave the dataset, and
plan 045's opt-out is all-or-nothing at the feature level. There is no per-type
or per-field control.

The sibling AI path applies exactly the discipline that is missing here, and
says so — `src/ai/askInbox.ts:12-20`: the model is shown a deliberately narrow
row shape because "every field included is a field that leaves the dataset".

**This is not a claim that the code is broken.** It does what it was built to
do. The question is whether it is acceptable, and that is the maintainer's
call — which is why this is a decision plan.

## Current state

- `src/inbox/projectDigest.ts:71-78` — `findSampleFieldName`: first string field, no sensitivity notion.
- `src/inbox/projectDigest.ts:152-157` — the fetch: `SAMPLE_WINDOW_SIZE` values, `strideSample` down to `SAMPLES_PER_TYPE`.
- `src/inbox/projectDigest.ts:175-186` — `formatContentGapsDigest`: samples and schema `description`s inlined into the prompt.
- `src/ai/askInbox.ts:12-20` — the contrasting discipline, with its stated reason.
- `plans/README.md` — plan 042 (the shared survey) and plan 045 (feature-level AI opt-outs) are the prior decisions this one sits between.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | `[success]` |

## Scope

**In scope:**
- A written decision (in this plan file, under a new "## Decision" heading)
- `README.md` — a section stating exactly which values leave the dataset on an AI read
- Only if the decision calls for it: an option on the digest/survey, its implementation and tests

**Out of scope:**
- Changing `MAX_SURVEYED_TYPES` / `SAMPLES_PER_TYPE` / `SAMPLE_WINDOW_SIZE` without a stated reason.
- Plan 078's allow-list guard (a safety fix on the same function — independent).
- Revisiting plan 045's feature-level opt-outs.

## Git workflow

- Branch: `advisor/086-survey-privacy`
- Conventional Commits: `docs:` for the decision and README; `feat:` if an option is added.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Establish the real exposure, with numbers

Do not reason in the abstract. Using `test-studio`'s schema (and any other
schema available):

1. For each document type, record what `findSampleFieldName` actually picks.
2. Note which of those picks would be sensitive on a plausible real schema
   (e.g. a `person` type whose first string field is `email` rather than
   `name`).
3. Record the worst case: types × samples actually sent.

**Verify**: your report contains a table of type → chosen field, and a
statement of how often the pick is a "title-ish" field versus something else.

### Step 2: Lay out the options with their costs

At least these three, each with what it costs the digest's usefulness:

- **A. Prefer a title-ish field.** Pick `title`/`name`/`label` when present,
  and sample nothing when absent. Cheap, no new API, and probably picks better
  samples anyway. Cost: types with no title-ish field contribute no samples.
- **B. Opt-in per type.** `surveySampleFields?: Record<typeName, string | false>`.
  Precise; more configuration for the integrator; the default still has to be
  A or C.
- **C. Sample nothing; send only type names, counts and schema descriptions.**
  Safest. Cost: the digest loses the concrete examples plan 042 added it for —
  confirm by reading plan 042 whether the samples are load-bearing for
  `contentGaps`' output quality.

For each, say whether it is a breaking change to any published option.

**Verify**: your report presents all three with costs, and a recommendation.

### Step 3: Get the decision, then write it down

Ask the maintainer. Record the outcome in this plan file under a new
"## Decision" heading, with the date and the reasoning — so this is not
re-litigated from scratch by the next audit.

**Verify**: this plan file contains a `## Decision` section.

### Step 4: Document what leaves the dataset, whatever was decided

This step happens **even if the decision is "change nothing"**. The README
currently does not say what an AI read sends, and that is the part that is
indefensible regardless of the sampling policy.

Add to `README.md`, near the AI-cost section:

> **What leaves your dataset on an AI read.** Ask and Find content gaps send a
> project survey to Sanity Agent Actions: for up to N document types, the type
> name, its document count, its schema `description`, and up to M real values
> of one string field per type. [State the field-selection rule after the
> decision.] Nothing else from your documents is sent. The per-row reads
> (Summarize, assess) send only the row fields listed in [link].

Fill N and M from the real constants.

**Verify**: `grep -c "leaves your dataset" README.md` → at least 1.

### Step 5: Implement, only if the decision requires it

Follow the decision. If it is option A, it is a change to
`findSampleFieldName` plus tests. If B, a new option with tests. If C, delete
the sampling and adjust `formatContentGapsDigest`.

**Verify**: `npm test` → all pass; `npm run build` → `[success]`.

## Test plan

Depends on the decision. In all cases:

1. A test asserting **which** field the selection rule picks, for a schema with
   a title-ish field and one without.
2. A test asserting the number of values sent per type does not exceed the
   documented maximum.
3. If an option is added: a test that an opted-out type contributes no samples.

**Verify**: `npm test` → all pass.

## Done criteria

- [ ] Step 1's type → field table is in your report
- [ ] Step 2's three options with costs and a recommendation are in your report
- [ ] This plan file has a `## Decision` section with a date and rationale
- [ ] `README.md` documents exactly what leaves the dataset, with real numbers
- [ ] Any code change matches the recorded decision and has tests
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The maintainer has not decided. Do **not** implement a default; the trade-off
  is theirs and options A and C produce materially different products.
- Step 1 shows the picked field is almost always title-ish already. Then option
  A is nearly free and the finding is smaller than it looked — say so plainly
  rather than building an opt-out nobody needs.
- Reading plan 042 shows the samples are essential to `contentGaps`' output
  quality. Then option C is off the table and the decision narrows to A or B.

## Maintenance notes

- Whatever is decided, the README section from Step 4 is the durable part: a
  consumer should be able to answer "what does this send?" without reading the
  source.
- `askInbox.ts:12-20` is the standard to hold new AI paths to — an explicit,
  documented list of fields that leave. A reviewer should ask for that whenever
  a new prompt is added.
- This plan deliberately does not treat the current behaviour as a bug. If the
  decision is "change nothing", that is a valid outcome and Step 4 still
  applies.
