# Plan 039: Give `assetIssues.ts`'s GROQ field-name interpolation the same allow-list guard `linkCheckerFindings.ts` already has

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/inbox/sources/assetIssues.ts src/inbox/sources/linkCheckerFindings.ts`
> If either changed since this plan was written, re-read both and compare
> against the excerpts below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (defense-in-depth, not a live vulnerability — see
  "Why this matters")
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`assetIssues.ts` builds two GROQ query strings by interpolating
`field.fieldName` and `altFieldName` directly into the query text (see
"Current state"). Neither value is exploitable *today*: `field.fieldName`
comes from `findAltEligibleImageFields`'s own walk of the integrator's own
schema, and `altFieldName` comes from `AssetIssuesOptions.altFieldName`, a
config-time value the integrator sets in their own `sanity.config.ts` —
both are fixed at Studio-build time, never influenced by dataset content,
document data, or an end user's own input.

That said, `linkCheckerFindings.ts` already does the equivalent
interpolation (a schema/config-derived field name spliced into a GROQ
query) **behind an explicit allow-list guard**
(`SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/`, confirmed at
`linkCheckerFindings.ts:93`), specifically so a field name can never
produce anything other than a plain GROQ property access, no matter where
it ultimately comes from. `assetIssues.ts` has no equivalent guard for the
same shape of interpolation. This is an inconsistency in defense-in-depth,
not a live hole — but it's cheap to close, and it removes the asymmetry
between two sources doing the same kind of thing with different levels of
care. If `altFieldName` (currently config-only) is ever exposed more
dynamically in the future (e.g. read from a document rather than static
config), this guard is what stands between that and a broken/malicious
query — better to have it in place now than to add it under pressure
later.

## Current state

- `src/inbox/sources/assetIssues.ts:278` and `:286` — the two
  interpolation sites (already includes this plan's own predecessor,
  Plan 020's poor-alt-text query — read both current lines, not just the
  first, since they now differ from what an older audit might have seen):
  ```ts
  `*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt}`,
  ```
  ```ts
  `*[_type == $type && defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt, "alt": ${field.fieldName}.${altFieldName}, "assetFilename": ${field.fieldName}.asset->originalFilename}`,
  ```
  Both interpolate `field.fieldName` (from `findAltEligibleImageFields`'s
  schema walk) and `altFieldName` (from `AssetIssuesOptions.altFieldName`,
  default `'alt'`) directly into the query string, with no validation of
  either.
- `src/inbox/sources/linkCheckerFindings.ts:92-93` — the guard to mirror:
  ```ts
  /** A plain top-level field name — no `[index]`/`.nested` — the only shape `singleReferenceTargetType` below knows how to resolve or `proposeFix` knows how to patch. */
  const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/
  ```
  used at `linkCheckerFindings.ts:116` and `:148` (`if
  (!SIMPLE_FIELD_PATH.test(fieldPath)) return undefined` /
  `return false`) — a plain guard-and-bail, not a throw.
- `AssetIssuesOptions.altFieldName` (`assetIssues.ts`, near the options
  interface) — confirmed it's a plain `string` option with a default of
  `'alt'`, set once at `structureInbox()` config time by the integrator.
- `findAltEligibleImageFields`'s own walk produces `fieldName` directly
  from `field.name` in the integrator's schema (a real Sanity field name,
  which Sanity itself already restricts to a safe identifier shape at
  schema-definition time — but this source has no *independent* check of
  that fact, it just trusts the schema).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/sources/assetIssues.ts`
- `src/inbox/sources/assetIssues.test.ts` (new test cases)

**Out of scope**:
- `src/inbox/sources/linkCheckerFindings.ts` — the guard to copy from,
  unchanged.
- Any other source — confirmed via `grep -rn '\${field' src/inbox/sources/*.ts`
  that GROQ field-name interpolation of this shape appears only in these
  two files.

## Git workflow

- Commits land directly on `main`. Message style: `fix: guard assetIssues'
  GROQ field-name interpolation the same way linkCheckerFindings does`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the same allow-list guard

Near the top of `assetIssues.ts`, add:

```ts
/** A plain field name — no `[index]`/`.nested`/`->` — the only shape safe to interpolate directly into a GROQ query string. Same guard `linkCheckerFindings.ts` uses for the equivalent interpolation. */
const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/
```

Apply it to both `field.fieldName` values inside `findAltEligibleImageFields`
(skip a field entirely if its name doesn't match — this is a schema field
name, so a real mismatch here would mean an unusual/invalid identifier the
walk should not have produced in the first place) **and** to
`altFieldName` once, at the top of the exported `assetIssues(...)`
function, before it's used in any query:

```ts
export function assetIssues(options: AssetIssuesOptions = {}): InboxSource {
  const {limit = 20, title = 'Asset issues', maxSizeBytes = 5 * 1024 * 1024, altFieldName = 'alt'} = options

  if (!SIMPLE_FIELD_PATH.test(altFieldName)) {
    throw new Error(
      `[sanity-plugin-structure-inbox] assetIssues: altFieldName must be a plain field name, got "${altFieldName}"`,
    )
  }
  // ...
```

`altFieldName` is a one-time, config-level option (not something that can
change per-render or per-document), so throwing here — at
`structureInbox()` config time, the same moment a genuinely malformed
config would already surface as a build/typecheck problem — is appropriate
and matches how other config-time misconfigurations in this plugin
already fail loudly rather than silently. `field.fieldName` (schema-
derived, walked at runtime) should instead be skipped defensively inside
`findAltEligibleImageFields` — a field the walk can't safely use is simply
not eligible, the same "returns `undefined`/skips" convention
`linkCheckerFindings.ts`'s own guard already uses, not a thrown error deep
inside a live render.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Add tests

In `assetIssues.test.ts`:
- `findAltEligibleImageFields` should skip a field whose `name` fails
  `SIMPLE_FIELD_PATH` (construct a fixture field with a name containing a
  character the regex rejects, e.g. a hyphen or bracket, and confirm it's
  excluded from the result — same pattern as the existing "skips a
  wrapper-object field with no alt sibling" case from Plan 020).
- `assetIssues({altFieldName: '...'})` throws when given a malformed
  `altFieldName` (e.g. one containing a dot or a GROQ-meaningful
  character) — confirm the throw message names the bad value, and that a
  normal `altFieldName` (the default `'alt'`, or any other plain
  identifier) does not throw.

**Verify**: `npm test -- assetIssues` → all pass, including the new cases.

### Step 3: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New case in `findAltEligibleImageFields`'s own test block: a field with
  an unsafe name is skipped, not included.
- New case(s) for `assetIssues(...)`'s own construction: a malformed
  `altFieldName` throws with a clear message; a normal one does not.
- Verification: `npm test` → all pass, including the new cases.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; the new cases from Step 2 exist and pass
- [ ] `npm run build` exits 0
- [ ] `SIMPLE_FIELD_PATH` (or an equivalently-named guard) exists in
      `assetIssues.ts` and gates both interpolation sites
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 039 updated

## STOP conditions

- A real, currently-passing `test-studio` schema field name (or any
  fixture already used in `assetIssues.test.ts`) fails the new
  `SIMPLE_FIELD_PATH` check — this would mean the regex is too strict for
  a genuinely valid Sanity field name shape. Sanity field names are
  restricted to a safe identifier pattern already, so this shouldn't
  happen; if it does, STOP and report rather than loosening the regex
  without understanding why a real field name needed it.

## Maintenance notes

If a third source ever needs this same "safe to interpolate into GROQ"
check, consider moving `SIMPLE_FIELD_PATH` into a shared location (e.g.
`src/inbox/sources/capability.ts`, alongside the other cross-source
primitives this session's own Plan 030 already consolidated there) instead
of a third copy-paste. Two copies (this file and
`linkCheckerFindings.ts`) is an acceptable amount of duplication for now —
matches this codebase's own stated preference for per-source
independence over premature sharing.
