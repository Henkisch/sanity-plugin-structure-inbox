# Plan 058: Let an editor fill missing alt text from the Inbox, one row or twenty

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Copy this file to
> `plans/058-quick-fix-missing-alt-text.md` and add its row to
> `plans/README.md` before starting (058 is the next free number — 021–028 are
> permanently reserved, 055/056 exist on disk without index rows).
>
> **Drift check (run first)**:
> `git diff --stat 97123ec..HEAD -- src/inbox/sources/assetIssues.ts src/inbox/types.ts src/inbox/InboxRow.tsx src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx src/inbox/sources/linkCheckerFindings.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM — this writes to real content documents, and the bulk path
  writes to many at once. Every mitigation below is load-bearing, not polish.
- **Depends on**: none (054–056 touch `useStableItems`, not this path)
- **Category**: direction (feature) + bug (wrapper-object asset path) + docs (`proposeFix` is undocumented)
- **Planned at**: commit `97123ec`, 2026-09-21

## Context — why this change

The Inbox is an inbox, so the goal is inbox zero. Today every `assetIssues`
finding is a dead end: the row tells you a Person has no alt text and hands you
a link to the document. Twenty Person records means twenty round trips through
the editor, and nothing about that says "work this away".

For a portrait, the correct alt text is already sitting in the document — it is
the person's name. That is a **safe, correct, deterministic** answer that needs
no AI, no judgement and no cost. The plugin should offer it, and should offer to
apply it to a whole selection at once. That single case covers the screenshot
that prompted this work: ~20 `person` rows, every one of them mechanically
answerable.

This was deliberately deferred once already —
`plans/020-alt-text-quality-and-wrapper-objects.md:151-159`:

> an AI-writes-it-for-you feature was explicitly deferred pending real evidence
> of need — do not fold that back in here.

That evidence now exists (maintainer, 2026-09-21). This plan is the unblock, and
it keeps 020's posture: deterministic by default, and it never ships a guess.

### Two findings that shaped the design

**1. No "Photo of" prefix.** The original framing was `"Porträtt av Daniel
Vaziri"`. WAI guidance is not to prefix alt text with "image of" / "photo of" /
"porträtt av" — assistive tech already announces the role, so the prefix is
redundant noise. The correct alt for that portrait is `Daniel Vaziri`. That is
both simpler *and* more correct, and it removes language handling from the
default entirely. An integrator who wants a prefix gets `suggestAlt`.

**2. Sanity's AI cannot see images.** Verified against the installed client
types (`node_modules/@sanity/client`) and
`https://www.sanity.io/docs/agent-actions/instructions`: `instructionParams`
accepts exactly `constant | field | document | groq`. There is no image input.
The image-related Agent Actions docs cover *generating* images, not reading
them.

So a built-in Agent Actions fallback could only guess alt text from the
document's **text**. For an article hero that produces confident, plausible,
wrong alt text — worse than missing, because nothing ever flags it again. This
plan therefore ships **no image-guessing AI of its own**. Real vision is
reachable, just not from inside the plugin: the query projects the asset's URL
and hands it to a `describeImage` hook the integrator implements with whatever
vision model they already pay for. Per-type prompting falls out for free, since
the hook receives `documentType` and `fieldName`.

## Current state

**`src/inbox/sources/assetIssues.ts:439`** — the source offers no fix at all:

```ts
return {items, loading, error, assign}
```

**`assetIssues.ts:299`** — the missing-alt query cannot distinguish a real title
from an `_id` fallback, so a fix built on `title` could write
`alt="person-a1b2c3"`:

```groq
*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})]
  | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt}
```

**`assetIssues.ts:47-52, 102-122`** — `EligibleImageField` records
`{documentType, documentTypeTitle, fieldName, fieldTitle}` but **not where the
image asset actually sits**. For a direct image field the asset is at
`<fieldName>.asset`; for the wrapper-object pattern (`imageWithAlt`, detected by
`hasImageSubfield` at `:106`) it is at `<fieldName>.<imageSubfield>.asset`. The
poor-alt query at `:307` assumes the direct case unconditionally:

```groq
"assetFilename": ${field.fieldName}.asset->originalFilename
```

so on a wrapper schema that projection is always `null` and the `filenameLike`
check silently never fires. Pre-existing; this plan needs the correct path
anyway, so it fixes it in passing.

**`assetIssues.ts:383-394`** — the row already carries what the fix needs, but
only inside the composite id string and the display subtitle:

```ts
id: `missingAlt:${doc._id}:${field.fieldName}`,
subtitle: `${field.documentTypeTitle} · ${field.fieldTitle}`,
intent: {type: 'edit', params: {id: doc._id, type: field.documentType}},
```

**`src/inbox/types.ts:151-156`** — the proposal contract already exists:

```ts
export interface FixProposal {
  summary: string
  apply: () => Promise<void>
}
```

**`src/inbox/sources/linkCheckerFindings.ts:505-529`** (`proposeLinkFix`) — the
precedent for a fix with **no AI call**, including the re-read-before-write
guard this plan copies:

```ts
const current = await client.fetch<string | null>(`*[_id == $id][0].${finding.fieldPath}`, {id: finding.fromId})
if (typeof current !== 'string' || !current.includes(finding.href)) return null
```

and its doc comment at `:496-504`: *"'insight, then action' doesn't require the
insight to come from an AI call when there's no real judgment call being made."*

**`src/inbox/InboxRow.tsx:651-653`** — the menu item already exists, gated on
`item.fixable`, labelled `t('fix.ask')` = **"Fix with AI"**
(`src/i18n/locales/en-US.ts:187`) *even for the link fix, which uses no AI*.
Pre-existing mislabel; this plan corrects it.

**`src/inbox/SelectionActions.tsx:236-460` / `MergedList.tsx:1145-1171`** — the
selection bar: Snooze, Delete, Assign, Hand off, Confirm. No fix action, and no
bulk AI action exists anywhere in the repo.

## Decisions taken (do not relitigate)

| Decision | Chosen |
|---|---|
| Deterministic answers | Integrator-declared field pairs (`altFromTitle`) + a `suggestAlt` callback. Free, instant, bulk-able |
| Non-deterministic answers | A `describeImage` hook the integrator implements with their own vision model. No built-in Agent Actions path — Sanity's AI cannot see images |
| Bulk | Deterministic fixes only. `describeImage` never runs from the selection bar |
| When AI runs | Only on an explicit per-row click. Never on render, never on selection, never in bulk |
| Poor alt text (filename-like / generic / too short) | **Not** fixable in v1 — filling an empty field cannot destroy editor-written text; replacing one can |
| Write target | The row's own `_id`, verbatim — published row patches published, draft row patches draft (same as `linkCheckerFindings.ts:524`) |
| Prefix | None. `Daniel Vaziri`, not `Porträtt av Daniel Vaziri`. `suggestAlt` is the supported way to have one |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Types | `npm run typecheck` | no output |
| Lint | `npm run lint` | `Found 0 warnings and 0 errors` |
| Tests | `npx vitest run` | all pass |
| Build | `npm run build` | completes; required before test-studio sees changes |
| Live check | `npm run link-watch` + `npm run dev` | see Step 9 |

Do **not** run `npm run format` (repo-wide `oxfmt`) — on this repo it reformats
~110 committed files.

## Scope

**In scope** — the only files you should modify:

- `src/inbox/sources/assetIssues.ts` — image path, query changes, suggestion helper, `proposeFix`, `quickFixable`
- `src/inbox/types.ts` — `InboxItem.quickFixable`, `proposeFix`'s new options arg
- `src/inbox/InboxRow.tsx` — the conditional menu label, `instantOnly` pass-through
- `src/inbox/MergedList.tsx` — the bulk handler
- `src/inbox/SelectionActions.tsx` — the bulk button
- `src/inbox/sources/linkCheckerFindings.ts` — honour `instantOnly`; set `quickFixable` on link findings
- `src/i18n/locales/en-US.ts` — new strings
- `README.md` — document `proposeFix`, the new options, the alt-text checks
- tests alongside the above

**Out of scope** (do NOT touch, even though they look related):

- **Poor-alt rows** (`assetIssues.ts:398-417`) — deliberately not fixable, see the decision table. Step 2 corrects their `assetFilename` *path*; it does not make them fixable.
- **Oversized / unused asset rows** — the only "fix" is deletion. Destructive, never a quick fix.
- **A built-in Agent Actions alt-text call** — explicitly rejected, see Context finding 2. Do not add `useAgentClient`/`promptJson` to this file.
- **`unpublishedDrafts`** — it deliberately never publishes (`unpublishedDrafts.ts:115-117`).
- **`documentValidation`** — validation rules are the project owner's schema, per 020's own out-of-scope note.
- **Nested images** (inside objects, arrays, Portable Text) — `findAltEligibleImageFields` is top-level-only by design (`assetIssues.ts:83-84`). Do not widen the walk here.
- **Draft/published id normalization** — decided above; patch the row's own `_id`.
- **Permission checks before the write** — no write path in this repo checks grants today. Adding one here only, inconsistently, is worse than the current uniform behaviour; a denied write already surfaces as `fix.error`. Record as a follow-up, do not build it.

## Git workflow

Branch `advisor/058-quick-fix-missing-alt-text`. Conventional Commits — this
repo's release depends on it. Suggested split:

```
fix: resolve the image asset path for wrapper-object image fields
feat: fill missing alt text from the Inbox, one row or a whole selection
fix: stop labelling a no-AI fix "Fix with AI"
docs: document proposeFix and the assetIssues alt-text checks
```

Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Teach the schema walk where the image actually is

`hasImageSubfield` (`assetIssues.ts:35-37`) currently returns a boolean. Change
it (or add a sibling) to return the sub-field's **name**, and record the result
on `EligibleImageField` (`:47-52`):

```ts
/**
 * Path from the document root to the image object itself — `fieldName` for a
 * direct image field, `fieldName.subfield` for the wrapper-object pattern.
 * Alt text lives at `<fieldName>.<altFieldName>` in both cases, but the asset
 * does not, which is why this is tracked separately.
 */
imagePath: string
```

Both segments are already `SIMPLE_FIELD_PATH`-guarded before use
(`:114`) — apply the same guard to the sub-field name, since `imagePath` is
spliced into GROQ exactly like `fieldName` is (plan 039's rule).

**Verify**: extend the existing `findAltEligibleImageFields` test with a
wrapper-object fixture and assert `imagePath === 'hero.image'` while
`fieldName === 'hero'`. `npx vitest run` → passes.

### Step 2: Use `imagePath` in the queries, and project what the fix needs

Missing-alt query (`:299`) — add a nullable real title and the asset URL:

```groq
*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})]
  | order(_updatedAt desc)[0...$limit]{
    _id,
    "title": coalesce(title, name, label, _id),
    "safeTitle": coalesce(title, name, label),
    "imageUrl": ${field.imagePath}.asset->url,
    _updatedAt
  }
```

`title` is unchanged so no row's display text shifts; `safeTitle` is the one the
fix is allowed to use.

Poor-alt query (`:307`) — correct the pre-existing wrong path:

```diff
-"assetFilename": ${field.fieldName}.asset->originalFilename
+"assetFilename": ${field.imagePath}.asset->originalFilename
```

Add `safeTitle?: string` and `imageUrl?: string` to `MissingAltRow` (`:191-195`).

**Verify**: `npm run typecheck` → no output. This step's poor-alt change is
behavioural — on a wrapper-object schema, `filenameLike` rows can now appear
where none did before. That is the bug being fixed, not a regression.

### Step 3: Add the config surface

Extend `AssetIssuesOptions` (`:170-179`):

```ts
/**
 * `'<documentType>.<fieldName>'` pairs whose image depicts the document's own
 * subject — a person's portrait, a product's pack shot. For those, the
 * document's own title IS the correct alt text, so the Inbox can fill it in
 * with no AI call and no cost. Deliberately declared rather than guessed: an
 * article's hero image is not a picture of its headline, and a wrong alt text
 * is worse than a missing one because nothing flags it again.
 *
 * The title is written verbatim, with no "Photo of"/"Porträtt av" prefix —
 * WAI guidance is that assistive tech already announces the role, so a prefix
 * is redundant. Use `suggestAlt` if you want one anyway.
 */
altFromTitle?: string[]
/**
 * Full control over the deterministic answer, and wins over `altFromTitle`.
 * Return `null` for "no safe answer here" — that row stays unfixable rather
 * than getting a guess.
 *
 * Synchronous and free on purpose: this is what the bulk action applies, so it
 * must not do I/O. Put anything that costs money or time in `describeImage`.
 * Must be a stable reference (module scope, or `useMemo`'d by the caller): it
 * feeds `items`, and anything in a `useItems` result that churns identity per
 * render takes the whole Structure tool down (see AGENTS.md).
 */
suggestAlt?: (ctx: AltContext) => string | null
/**
 * Describe an image this plugin has no safe answer for, using your own vision
 * model — Sanity's Agent Actions cannot see images (its `instructionParams`
 * accept only `constant | field | document | groq`), so there is deliberately
 * no built-in fallback here rather than one that guesses from the document's
 * text.
 *
 * Runs only when an editor clicks "Fix with AI" on one specific row. Never on
 * render, never on selection, and never from the bulk action — whatever this
 * costs, it is charged one deliberate click at a time. `ctx.documentType` and
 * `ctx.fieldName` let you prompt differently per kind of image.
 *
 * Return `null` when the model can't describe it confidently.
 */
describeImage?: (ctx: AltContext & {imageUrl: string}) => Promise<string | null>
```

with the shared context exported for integrators:

```ts
/** @public */
export interface AltContext {
  documentId: string
  documentType: string
  fieldName: string
  /** The document's own title/name/label — absent when it has none. */
  title?: string
}
```

### Step 4: Extract a pure suggestion helper (and test it)

Exported from `assetIssues.ts` so it gets its own test, like `classifyAltText`
and `normalizeForComparison` already are:

```ts
export function suggestAltText(
  ctx: AltContext,
  options: {altFromTitle?: string[]; suggestAlt?: AssetIssuesOptions['suggestAlt']},
): string | null {
  const fromCallback = options.suggestAlt?.(ctx)
  if (typeof fromCallback === 'string' && fromCallback.trim()) return fromCallback.trim()
  // A callback that returned null has made a decision — `altFromTitle` must not
  // override it. This is why it isn't a `??` chain.
  if (fromCallback !== undefined) return null
  if (!options.altFromTitle?.includes(`${ctx.documentType}.${ctx.fieldName}`)) return null
  return ctx.title?.trim() || null
}
```

### Step 5: Build a memoized target map and set the row flags

Alongside `items` (`:352-421`), build a `Map<string, AltTarget>` keyed by row id
— the same shape `linkCheckerFindings`'s `findingsByKey` uses, for the same
reason: the row id is a string, and `proposeFix` only gets the item back.

```ts
interface AltTarget {
  documentId: string
  documentType: string
  fieldName: string
  title?: string
  imageUrl?: string
  /** Non-null only when a deterministic answer exists — this is what makes the row quick-fixable. */
  suggestion: string | null
}
```

Compute it in the **same `useMemo`** that builds `items` (return `{rows, targets}`
and destructure) so the two can never disagree. On each missing-alt row set:

```ts
quickFixable: suggestion !== null,
fixable: suggestion !== null || Boolean(describeImage && doc.imageUrl),
```

Add to `InboxItem` (`src/inbox/types.ts`, beside `fixable` at `:131`):

```ts
/**
 * Whether a fix for this item is computable with no network call and no cost —
 * the subset of `fixable` a bulk selection is allowed to apply. `fixable` alone
 * is not enough for bulk: a model-backed proposal bills per row, so twenty
 * selected rows would silently spend twenty of them.
 */
quickFixable?: boolean
```

**Verify**: unit test — a `person.portrait` row with `safeTitle: 'Daniel Vaziri'`
is `quickFixable`; the same row with `safeTitle: undefined` is neither
`quickFixable` nor `fixable` when no `describeImage` is configured.

### Step 6: Implement `proposeFix`

In `src/inbox/types.ts`, amend `proposeFix` (`:275-290`) — keep and extend its
existing doc comment:

```ts
proposeFix?: (item: InboxItem, options?: {instantOnly?: boolean}) => Promise<FixProposal | null>
```

Document that `instantOnly: true` means "propose only what costs nothing and
needs no round trip", that the bulk path always passes it, and that a source
honouring it must return `null` rather than fall back to a paid call.

In `assetIssues.ts` — note there is **no** `useAgentClient` and no `promptJson`
here; that is deliberate:

```ts
const proposeFix = useCallback(
  async (item: InboxItem, options?: {instantOnly?: boolean}): Promise<FixProposal | null> => {
    const target = altTargets.get(item.id)
    if (!target) return null

    // Re-read before proposing: the live query can be seconds stale, and
    // someone may have filled this in by hand since. Same guard, same reason as
    // `proposeLinkFix` (linkCheckerFindings.ts:509-517).
    const current = await client.fetch<unknown>(
      `*[_id == $id][0].${target.fieldName}.${altFieldName}`,
      {id: target.documentId},
    )
    if (typeof current === 'string' && current.trim()) return null

    const write = (alt: string) => async () => {
      await client.patch(target.documentId).set({[`${target.fieldName}.${altFieldName}`]: alt}).commit()
    }

    if (target.suggestion) {
      return {summary: `Set alt text to "${target.suggestion}"`, apply: write(target.suggestion)}
    }

    if (options?.instantOnly || !describeImage || !target.imageUrl) return null

    const described = await describeImage({
      documentId: target.documentId,
      documentType: target.documentType,
      fieldName: target.fieldName,
      title: target.title,
      // Capped width: the integrator pays for this call, and no vision model
      // needs the full-resolution original to write one sentence.
      imageUrl: `${target.imageUrl}?w=1024&fit=max&auto=format`,
    })

    const alt = described?.trim()
    if (!alt || alt.length > 300) return null
    return {summary: `Set alt text to "${alt}"`, apply: write(alt)}
  },
  [altFieldName, altTargets, client, describeImage],
)
```

**Also**: wrap the source's return in `useMemo`, the way
`linkCheckerFindings.ts:590-606` does. `assetIssues.ts:439` currently returns a
fresh object literal every render; adding a callback to it makes that worse, and
AGENTS.md's loudest invariant is that nothing in a `useItems` result may churn
identity per render.

### Step 7: Honour `instantOnly` in `linkCheckerFindings`

In `proposeFix` (`:531-588`), before the reference branch reaches Agent Actions,
return `null` when `options?.instantOnly`. The link branch (`proposeLinkFix`) is
already AI-free and stays available. Set `quickFixable: true` on link findings
that are already `fixable` — they cost nothing, so they belong in bulk too.

### Step 8: Two honest labels, and the bulk action

`src/i18n/locales/en-US.ts`:

```ts
'fix.quick': 'Quick fix',
'fix.bulk': 'Fix alt text',
'fix.bulkDone': 'Filled alt text on {{count}} documents',
'fix.bulkSkipped': '{{count}} rows need review',
```

`InboxRow.tsx:647-655` — the `fix` entry stays gated on `item.fixable`, but its
label becomes conditional: `item.quickFixable` → `t('fix.quick')`, otherwise
`t('fix.ask')`. This also retires the standing mislabel where the AI-free
broken-link fix advertised itself as "Fix with AI". Pass
`{instantOnly: item.quickFixable}` from `handleProposeFix`, so a quick-fixable
row can never reach a paid path.

Leave `handleProposeFix`/`handleApplyFix`'s two-ref in-flight guards
(`InboxRow.tsx:322-373`) exactly as they are — plan 044 established that a
`status === 'loading'` state read does not close a same-tick double click, and
this path now performs a real write.

`MergedList.tsx` — a `confirmQuickFix` handler beside `confirmSnooze` (`:434-438`)
and `confirmDelete` (`:477-493`):

1. Filter the selection to rows where `row.item.quickFixable` **and** the row's
   source offers `proposeFix` — mirroring how `confirmDelete` filters to sources
   offering `remove` (`:475`).
2. For each: `await report.proposeFix(item, {instantOnly: true})`, then
   `await proposal.apply()`. Skip a `null` proposal silently — it means the alt
   text was filled between the query and the click, which is a success, not a
   failure.
3. `Promise.allSettled` so one failure does not strand the rest — the same shape
   as `resolveOrClearRows` (`:284-289`). Bound concurrency; do not fire 200
   patches at once.
4. Toast via `useUndoToast` (`:207`) **with no undo** — the same rule `resolve`
   already follows (`:312-314`): this is a real write to a shared document, not
   local pane state, so the plugin must not imply it can be taken back. Report
   skips: `Filled alt text on 18 documents · 6 rows need review`.
5. Failures `console.error('[sanity-plugin-structure-inbox] could not fix item', …)`
   like every sibling handler.

`SelectionActions.tsx` — a button beside Snooze (`:294-296`), rendered only when
at least one selected row is `quickFixable`, labelled `t('fix.bulk')`. No
confirm dialog: the action is free, additive, and only ever touches fields that
were empty a moment ago.

Do **not** add a `describeImage` path here.

### Step 9: Verify in the real Studio

`npm run build` first — **test-studio consumes `dist/`, not `src/`**, so an
unbuilt change is invisible (AGENTS.md). Then `npm run link-watch` + `npm run dev`.

With a `person` type carrying a `portrait` image field with an `alt` sub-field:

```ts
structureInbox({sources: [assetIssues({altFromTitle: ['person.portrait']})]})
```

Confirm, in order:

1. Person rows show **Quick fix**, not "Fix with AI"
2. One row: propose → summary reads `Set alt text to "Daniel Vaziri"` → Apply → the row leaves the list on the next live-query tick, and the document really has the alt text
3. Select ten → **Fix alt text** in the selection bar → all ten clear, one toast, no undo offered
4. A document with no title/name/label is **not** quick-fixable and offers no menu entry
5. Add a wrapper-object image field (`hero` → `{image, alt}`) on another type and confirm it is detected, that `imagePath` resolves, and that a `filenameLike` poor-alt row can now appear for it
6. With a `describeImage` hook returning a fixed string, a non-declared field shows "Fix with AI", proposes that string on click, and — assert this explicitly — the hook is **never called** during render, during selection, or by the bulk action
7. Select a mix of quick-fixable and not — the toast reports both counts

Plan 020's step 5 was skipped this way and left a documented gap. Do not skip
this one.

### Step 10: Documentation

`README.md`:

- Document `proposeFix` in "Writing your own" (`:135-189`) — entirely absent today, for both built-in cases
- Document `quickFixable` and `instantOnly`, including the rule that a bulk selection only ever applies quick fixes
- Add the prose section on `assetIssues`'s four checks that plan 020's step 5 never delivered — only the table row at `:86` was updated
- Document `altFromTitle` / `suggestAlt` / `describeImage` in the options table, with the worked `describeImage` example
- State plainly, in the AI section (`:307-330`), that Sanity's Agent Actions cannot see images and that this is why alt-text description is a bring-your-own-model hook. Otherwise the next person will "fix" its absence by adding one that guesses
- State the no-prefix rule and why, so nobody "fixes" that back to "Photo of …"

## Test plan

Unit (`assetIssues`):

- `findAltEligibleImageFields` — wrapper object yields `imagePath: 'hero.image'` with `fieldName: 'hero'`; direct image yields `imagePath === fieldName`; a sub-field name failing `SIMPLE_FIELD_PATH` is skipped
- `suggestAltText` — declared field + title → the title; declared field, no title → `null`; undeclared field → `null`; `suggestAlt` returning a string wins over `altFromTitle`; `suggestAlt` returning `null` **blocks** the `altFromTitle` fallback (the non-vacuous one — a naive `??` chain passes every other case and fails this)
- row flags — `quickFixable` only with a suggestion; `fixable` with a suggestion **or** (`describeImage` and an `imageUrl`); poor-alt rows never carry either

Integration (`proposeFix`):

- alt already filled since the query → resolves `null`, no patch issued
- deterministic hit → patches `${fieldName}.${altFieldName}` on the row's own `_id`; assert a draft-id row patches the draft id, not the published one
- `instantOnly: true` on a `describeImage`-only row → `null`, **and the hook was not called** (non-vacuous: this is the guard that stops bulk from spending money)
- `describeImage` returning `null`, `''`, or a 400-character string → `null`, no patch

Bulk (`MergedList`):

- a mixed selection applies only `quickFixable` rows and reports the skip count
- one failing apply does not prevent the others (`Promise.allSettled`)
- the toast offers no undo

## Done criteria

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` → 0 warnings, 0 errors
- [ ] `npx vitest run` all pass, including the new tests
- [ ] `npm run build` succeeds
- [ ] Step 9's seven live checks all confirmed in test-studio
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row for 058 updated
- [ ] Commits follow Conventional Commits, no `[skip ci]` in any body

## STOP conditions

Stop and report (do not improvise) if:

- The drift check shows any in-scope file changed since `97123ec`
- `FixProposal`, `InboxItem`, or `EligibleImageField` no longer match the excerpts above
- Adding `proposeFix` to `assetIssues` triggers "Maximum update depth exceeded" in test-studio — that is the AGENTS.md identity-churn failure, and it means the memoization in Step 5/6 is wrong. Do not paper over it with `useStableItems`; the built-ins are not supposed to rely on it
- A patch in Step 9 writes to an id other than the row's own `_id`
- The bulk action calls `describeImage` even once
- Any step's verification fails twice after a reasonable fix attempt

## Maintenance notes

- **`instantOnly` is the whole cost story.** If a future source implements
  `proposeFix` and ignores the argument, a twenty-row bulk selection starts
  billing twenty calls silently. Any new `proposeFix` must honour it.
- **Do not add a built-in image-describing AI** without first re-checking
  whether Agent Actions has gained image input. As of 2026-09-21 its
  `instructionParams` are `constant | field | document | groq` only, and a
  fallback that guesses from the document's text is the exact "confident and
  wrong" failure plan 020 warned about. If Sanity ships vision, revisit — the
  `describeImage` signature already has the right shape to back with it.
- **Do not make poor-alt rows fixable** without a fresh decision. Excluded on
  purpose: filling an empty field cannot destroy editor-written text, replacing
  one can, and `classifyAltText` is a heuristic.
- **Do not add a "Photo of"/"Porträtt av" prefix to the default.** Contrary to
  WAI guidance, considered and rejected here. `suggestAlt` is the supported way.
- **Left out on purpose**: a permissions check before the write. No write path
  in this repo checks grants today (`linkCheckerFindings.ts:524` included); a
  denied write surfaces as `fix.error`. Worth doing repo-wide, as its own plan —
  not here, where it would be the only path that checks.
- **Also left out**: draft/published normalization. The decision is to patch the
  row's own `_id`. If revisited it affects `linkCheckerFindings` identically and
  belongs in one plan covering both.
