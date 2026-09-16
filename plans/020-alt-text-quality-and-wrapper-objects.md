# Plan 020: Catch poor-quality alt text, and the "wrapper object" schema pattern

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- src/inbox/sources/assetIssues.ts src/inbox/sources/assetIssues.test.ts test-studio/schemaTypes`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature) + bug (real detection gap)
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

`assetIssues` (`src/inbox/sources/assetIssues.ts`) already flags **missing**
alt text — but nothing today flags alt text that exists and is useless:
`"IMG_2831.jpg"`, `"image"`, or a single space all currently pass, silently,
forever. The maintainer's own framing: writing a *good* alt text is the hard
part, so editors reach for the path of least resistance, and this plugin
currently can't tell the difference between a real description and a
placeholder. This is a real, common accessibility gap this plugin is
well-positioned to catch — no AI needed, same deterministic-checks posture
`assetIssues`'s other two checks (oversized, unused) already use.

Separately, `assetIssues`'s alt-text detection today only recognizes **one**
schema modeling convention: a document field whose own type *is* `image`,
customized with its own `alt` sub-field (Sanity's own recommended pattern,
and the only one this project's own `test-studio` schema currently
demonstrates). A second, also-common convention exists in real projects: a
reusable **wrapper object type** — e.g. `imageWithAlt`, with an `image`
sub-field and a sibling `alt` sub-field — used as the field's type instead of
customizing `image` directly. Today, `findAltEligibleImageFields` requires
the field's own type to satisfy `isImageSchemaType` (see "Current state"
below), so a wrapper-object field is silently skipped entirely: never
flagged for missing alt text, and (after this plan) never checked for
quality either. Both gaps should close together — the wrapper-object case is
really about *finding* the right fields; the quality check runs on whatever
that walk finds, from either convention.

## Current state

- `src/inbox/sources/assetIssues.ts` — the whole source. Two places matter:
  - `findAltEligibleImageFields` (lines 81–112): walks every real document
    type's top-level fields, keeping ones whose type is an image type
    (`isImageSchemaType(field.type)`) that also declares its own
    `altFieldName` sub-field:
    ```ts
    for (const field of type.fields ?? []) {
      if (!isImageSchemaType(field.type)) continue
      const altField = field.type.fields?.find((sub) => sub.name === altFieldName)
      if (!altField) continue

      results.push({
        documentType: typeName,
        documentTypeTitle: type.title || typeName,
        fieldName: field.name,
        fieldTitle: field.type.title || field.name,
      })
    }
    ```
    This is the **customized-image** convention only. It cannot see a field
    like `heroImage: {type: 'imageWithAlt'}` where `imageWithAlt` is a
    separate object type — `field.type` there is `imageWithAlt`, not
    `image`, so `isImageSchemaType(field.type)` is false and the field is
    skipped before the alt-sub-field check ever runs.
  - The missing-alt query, inside `useItems()` (around line 226):
    ```ts
    client.fetch<MissingAltRow[]>(
      `*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt}`,
      {type: field.documentType, limit},
    )
    ```
    **Important**: this query already works unchanged for the wrapper-object
    case too. Whether `heroImage`'s type is `image` (customized) or
    `imageWithAlt` (wrapper), the alt text lives at the same JSON path,
    `heroImage.alt` — GROQ only sees document shape, never schema type
    names. So fixing the *eligibility walk* (below) is enough; no query
    change is needed for the wrapper-object case.
- `src/inbox/sources/assetIssues.test.ts` — tests `findAltEligibleImageFields`
  against hand-built fixture schema types (`FixtureType`, `imageType()`,
  `postType()`). Model new tests after `postType()`'s own shape (lines
  20–36). The fixture's own doc comment (lines 5–12) explains exactly what
  real-schema shape it's standing in for — read it before writing new
  fixtures.
- `test-studio/schemaTypes/documents/post.ts` (lines 18–21) — the **only**
  real schema example in this repo today, and it's the customized-image
  convention:
  ```ts
  defineField({
    name: 'heroImage',
    type: 'image',
    options: {hotspot: true},
    fields: [defineField({name: 'alt', type: 'string', title: 'Alt text'})],
  })
  ```
  There is no wrapper-object example anywhere in this repo yet. Step 4 below
  adds one, so the new eligibility case is exercised live, not just in
  fixture tests — this project's own established discipline (see
  `plans/019-cleared-means-sanity-said-so.md`'s own "real bug found via live
  testing" note) is to verify schema-walk changes against a real Studio, not
  fixtures alone.
- `src/inbox/sources/releaseAttention.ts` — the pattern to copy for the new
  quality check: a pure `classify*(facts, ...): SomeUnion | null` function,
  fully unit-testable with no GROQ or React in it at all, called from
  `useItems()` after a plain fetch. Use the same shape for the new
  `classifyAltText` function this plan adds — don't inline the heuristic
  into the query or into JSX.
- Repo conventions to match: no comments explaining *what* code does (names
  should already say that) — only *why*, when non-obvious. See any existing
  doc comment in `assetIssues.ts` for the house style: explain the
  constraint or trade-off, not the mechanism. TSDoc-style `/** ... */` above
  exported functions; plain `//` above implementation details.

## Commands you will need

| Purpose   | Command            | Expected on success  |
|-----------|--------------------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0, no errors     |
| Lint      | `npm run lint`      | exit 0, no errors     |
| Tests     | `npm test`          | all pass (367 today, before this plan's new tests) |
| Build     | `npm run build`     | exit 0, clean         |

Full sweep (run all four) after each step below, same as every other change
in this repo's own history.

## Scope

**In scope**:
- `src/inbox/sources/assetIssues.ts`
- `src/inbox/sources/assetIssues.test.ts`
- `test-studio/schemaTypes/documents/event.ts` (add one wrapper-object field
  to exercise the new eligibility case live — pick `event.ts` specifically
  because it currently has no image field of its own, so there's no risk of
  colliding with the existing `post.ts` example)
- `test-studio/sanity.config.ts` (only if a new source option needs adding
  to the `default` workspace's own `assetIssues()` call — see Step 3)
- `README.md` (the "Asset issues" section — update to describe both new
  checks)

**Out of scope** (do NOT touch, even though related):
- `src/inbox/sources/documentValidation.ts` — a schema `validation` rule
  *could* theoretically also catch bad alt text (a custom `Rule.custom`),
  but that's the project owner's own schema to write, not this plugin's job;
  don't add alt-text-specific logic there.
- Any AI/Agent Actions call — this plan is explicitly the deterministic,
  no-AI half of the alt-text problem (see the maintainer's own reasoning
  in this plan's git history / conversation: an AI-writes-it-for-you
  feature was explicitly deferred pending real evidence of need — do not
  fold that back in here).
- `test-studio/schemaTypes/documents/post.ts` and `author.ts` — leave the
  existing customized-image example alone; it's what today's passing tests
  already cover.

## Git workflow

- Branch: none required by repo convention observed in `git log` — commits
  land directly on `main` in this project's own history. Match that unless
  told otherwise.
- Commit style, from `git log --oneline -10`: `type: short imperative
  summary`, e.g. `feat: catch poor-quality and wrapper-object alt text`. One
  commit per step below is fine, or one combined commit — this repo's own
  history shows both, no strict rule.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Extend `findAltEligibleImageFields` to also recognize wrapper objects

In `src/inbox/sources/assetIssues.ts`, change the walk so a field is
eligible either when (a) today's case — its own type is an image type with
an `altFieldName` sub-field — or (b) its type is some other object type
that itself contains at least one sub-field whose type is an image type,
**and** a sibling sub-field named `altFieldName` on that same wrapper type.
Both cases produce the identical `EligibleImageField` shape (the GROQ query
downstream needs no change — see "Current state" above for why).

Suggested shape (adapt names to taste, but keep the two-case structure
explicit and separately testable):

```ts
function hasAltSibling(fields: {name: string; type: WalkableSchemaType}[] | undefined, altFieldName: string): boolean {
  return Boolean(fields?.some((sub) => sub.name === altFieldName))
}

// inside the existing loop, replacing the current single `if`:
const isDirectImage = isImageSchemaType(field.type)
const isWrapperWithImage =
  !isDirectImage && Boolean(field.type.fields?.some((sub) => isImageSchemaType(sub.type)))

if (!isDirectImage && !isWrapperWithImage) continue
if (!hasAltSibling(field.type.fields, altFieldName)) continue
```

Keep the existing doc comment's "top-level fields only, v1" caveat — this
plan does not add nested-field walking, only a second top-level shape.
Extend that same doc comment with one sentence naming the new case.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Add tests for the wrapper-object case

In `src/inbox/sources/assetIssues.test.ts`, add a fixture wrapper type
(model after the file's own `imageType()` helper) and at least these cases,
alongside the existing `describe('findAltEligibleImageFields', ...)` block:

- A wrapper object type (`imageWithAlt`-shaped: `fields: [{name: 'image',
  type: imageType()}, {name: 'alt', type: stringType}]`) used as a
  document's top-level field type → **is** found, same result shape as the
  existing customized-image test.
- The same wrapper shape but with no `alt` sibling → **not** found.
- A wrapper object whose inner image sub-field is named something other
  than `image` (e.g. `asset`) → still found — the inner field's own name
  must not matter, only that *some* sub-field is an image type.

**Verify**: `npm test -- assetIssues` → all pass, including the new cases.

### Step 3: Add `classifyAltText` and wire a third check into `useItems()`

Add a new pure function, alongside `formatAssetSize` (same file):

```ts
export type AltTextIssue = 'filenameLike' | 'placeholder' | 'tooShort'

const GENERIC_ALT_WORDS = new Set(['image', 'photo', 'picture', 'img', 'graphic', 'photograph'])
const MIN_ALT_LENGTH = 4

/** Normalizes for comparison: lowercase, strip a file extension, collapse `-`/`_`/whitespace runs to single spaces. Exported for its own test. */
export function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_\s]+/g, ' ')
    .trim()
}

/**
 * Classifies alt text that exists but isn't pulling its weight — never
 * called on missing alt text, that's the existing separate check. Returns
 * `null` for anything that looks like a real description; this function
 * has no opinion on whether a real description is *accurate*, only on
 * whether it looks like a placeholder or a lazy default.
 */
export function classifyAltText(altText: string, assetFilename?: string): AltTextIssue | null {
  const normalized = normalizeForComparison(altText)
  if (!normalized || normalized.length < MIN_ALT_LENGTH) return 'tooShort'
  if (GENERIC_ALT_WORDS.has(normalized)) return 'placeholder'
  if (assetFilename && normalized === normalizeForComparison(assetFilename)) return 'filenameLike'
  return null
}
```

Then, in `useItems()`, for each entry in `altEligibleFields`, add a second
query alongside the existing missing-alt one — same `field.fieldName`
pattern, but selecting documents where the alt field **is** defined, and
dereferencing the asset for its filename:

```ts
client.fetch<{_id: string; title: string; _updatedAt?: string; alt: string; assetFilename?: string}[]>(
  `*[_type == $type && defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{
    _id, "title": coalesce(title, name, label, _id), _updatedAt,
    "alt": ${field.fieldName}.${altFieldName},
    "assetFilename": ${field.fieldName}.asset->originalFilename
  }`,
  {type: field.documentType, limit},
)
```

`${field.fieldName}.asset->originalFilename` assumes the image sub-field's
own asset reference is named `asset` — true for Sanity's own `image` type
(both the customized-image and wrapper-object-with-an-`image`-sub-field
cases dereference the same way, since in both the actual asset reference
still lives at `<field>.asset`). If Step 2's "differently-named inner
sub-field" test result surfaces a real case where this dereference needs
the sub-field's own name instead of the literal `asset`, treat it as a STOP
condition — the query needs the eligibility walk to also carry the inner
field's own name, which is a bigger change than this step describes.

Filter the fetched rows through `classifyAltText`, keep only non-null
results, and push a row per finding — same `InboxItem` shape the existing
missing-alt rows use, with `category` set to a new, distinct string per
issue kind (e.g. `'Alt text looks like a filename'`, `'Generic alt text'`,
`'Alt text too short'`) so the three read as different findings, not one
vague "bad alt text" bucket. Reuse the same `assign`/`assignee` wiring the
existing missing-alt rows already have (same `withAssignee` helper, same
target-id shape `` `poorAlt:${doc._id}:${field.fieldName}` ``, mirroring
the existing `` `missingAlt:${doc._id}:${field.fieldName}` `` convention).

Cap total poor-alt-text rows the same way `unused`/`oversized` already are
(`limit`, already an existing option) — no new option needed unless you
find the two alt-text queries (missing + poor-quality) meaningfully
compete for the same `limit` budget in a way that under-reports one; if so,
STOP and report rather than guessing a new default.

**Verify**: `npm run typecheck && npm run lint` → both exit 0.

### Step 4: Add a wrapper-object schema fixture to `test-studio`, and verify live

In `test-studio/schemaTypes/documents/event.ts`, add a new reusable object
type (in a new file, `test-studio/schemaTypes/objects/imageWithAlt.ts`,
exported and added to `test-studio/schemaTypes/index.ts`'s `schemaTypes`
array) and one field on `event` using it — e.g. `coverImage: {type:
'imageWithAlt'}`. Follow this repo's own `defineType`/`defineField` style,
matching `post.ts`'s own formatting.

Then, live in `test-studio` (`npm run dev`, already required to be running
per this repo's own workflow):
- Upload a real image to a real event's `coverImage`, leave alt text empty
  → confirm it now shows up as a missing-alt-text row (proves Step 1's
  wrapper-object eligibility fix reaches the existing missing-alt query,
  unchanged).
- Set that same image's alt text to the literal filename you uploaded (or
  a generic word like `"photo"`, or a single space) → confirm a poor-alt
  row appears, with the right `category` text for whichever case you tried.
- Set a real, descriptive alt text → confirm no row appears for it.
- Clean up whatever test event/image you created afterward, same as this
  repo's own established practice (see `plans/README.md`'s own notes on
  leaving the dataset as found after manual verification).

**Verify**: manual, via the browser — no automated command replaces this
step; the schema-walk and GROQ dereference are exactly the kind of thing
this repo's own history shows failing silently without a live check
(`plans/019-cleared-means-sanity-said-so.md`'s "real bug found... during
live verification" note is the precedent).

### Step 5: Update README

In `README.md`'s "Asset issues" section, add the two new checks alongside
the existing three (oversized/unused/missing alt), and add one sentence
each describing:
- The wrapper-object schema convention this source now also recognizes,
  with a short example matching Step 4's fixture shape.
- The three poor-alt-text categories and what each one catches.

Match the existing section's own tone (see the current "No `resolve`:
fixing any of these means editing the asset or the document that
references it" closing line — keep that, it's still true for all five
checks now, not just three).

## Test plan

- `src/inbox/sources/assetIssues.test.ts`:
  - Three new `findAltEligibleImageFields` cases from Step 2.
  - New `describe('classifyAltText', ...)` block: filename match (exact
    and with extension/dash variations), each generic word in
    `GENERIC_ALT_WORDS`, too-short (empty string, whitespace-only, 1–3
    chars), and a real descriptive string returning `null`. Model the
    `describe` block structure after the existing `formatAssetSize`
    block in the same file.
  - New `describe('normalizeForComparison', ...)` block if you want it
    tested directly rather than only through `classifyAltText` — optional,
    executor's judgment.
- Verification: `npm test` → all pass, previous 367 plus every new case
  from this plan.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new test from Step 2 and the Test plan above
      exists and passes
- [ ] `npm run build` exits 0
- [ ] Step 4's live verification actually performed (not skipped) — missing,
      poor-quality, and good alt text each produce the right on-screen
      result, then the test event/image is cleaned up
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `README.md`'s "Asset issues" section describes both new checks
- [ ] `plans/README.md` status row for 020 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  quoted above (drift since this plan was written).
- Step 2's "differently-named inner sub-field" test reveals the
  `asset->originalFilename` dereference in Step 3 needs the inner field's
  own name rather than the literal `asset` — this needs a bigger change to
  what `EligibleImageField` carries, not a quick patch.
- A step's verification fails twice after a reasonable fix attempt.
- You find `GENERIC_ALT_WORDS`/`MIN_ALT_LENGTH` producing obvious false
  positives against `test-studio`'s own real dataset during Step 4 — report
  the exact false positive rather than silently tuning the constants.

## Maintenance notes

- If a future source ever needs "does this field have alt text worth
  trusting" outside `assetIssues` itself, export `classifyAltText` from
  this file rather than duplicating the heuristic — it's already a pure,
  dependency-free function.
- `GENERIC_ALT_WORDS` is deliberately a small, English-only list — this
  matches every other user-facing string default in this plugin (see
  `src/i18n/locales/en-US.ts`), not a localization gap specific to this
  feature. Don't expand it defensively; wait for a real false-negative
  report.
- The wrapper-object eligibility case (Step 1) assumes the inner image
  sub-field's own asset reference lives at `<field>.asset` — true for
  Sanity's own `image` type nested inside any object, by construction. If
  a future project's wrapper type nests the image *again* (an object
  containing an object containing the image), that's out of scope here —
  same "top-level only, v1" limit the existing walk already documents.
