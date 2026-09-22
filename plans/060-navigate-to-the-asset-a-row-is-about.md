# Plan 060: Let an asset row take you to the asset

> **Status: DONE** — implemented and verified live, not yet committed. The
> plan's original design was **overturned by the maintainer during execution**
> and the record below is kept deliberately, because the reasoning that
> replaced it is the more valuable half.
>
> **What the plan got wrong.** It sent an asset row into the *document that
> uses the asset*, with the image field focused, on the theory that you fix an
> oversized image where it is used. The maintainer's answer, on seeing it:
> "I dont expect to end up on a field for the asset, I want to go to the source
> or the media library". That is right, and the field-navigation machinery
> (`findAssetFieldSegments`, `resolveFocusPaths`, `toNavigableId`, the
> using-documents query) was deleted again — it is in this branch's history if
> ever wanted as a secondary action.
>
> **What the investigation then established**, all verified against
> `sanity@6.13.0` and a running Studio rather than assumed:
>
> 1. **Sanity assets are immutable.** An asset `_id` embeds a hash of its
>    bytes, so no "replace this file" operation exists anywhere — core or
>    plugin. What `sanity-plugin-media` calls Replace is
>    `assetsActions.updateImageReferences`: a reference migration across every
>    referencing document, images only, with its own "could take a few minutes"
>    toast.
> 2. **There is no native asset surface outside a document field.**
>    `createDatasetImageAssetSource`/`createDatasetFileAssetSource` ship no
>    `openInSource`, so Sanity's own "Open in Source" declines every dataset
>    asset. Only the Media Library source implements it, for assets this
>    source cannot see. The one native asset manager — list, **Show usage**,
>    **Delete** — is the `DatasetAssetSource` browse dialog, rendered by the
>    `@internal` `AssetSourceDialog`, only ever from an image/file input.
>    Confirmed by opening it in the Studio and reading its menu.
> 3. **Sanity's dataset has two asset types, not five.** `sanity.imageAsset`
>    and `sanity.fileAsset`; the latter is PDFs, audio, video, archives and
>    fonts alike. There is no `sanity.audioAsset`, and `sanity.videoAsset`
>    belongs to the Media Library resource.
>
> **The design that shipped**, chosen by the maintainer as option C of three
> ("vi vill göra minimalt med special tweaks, b är uteslutet, C känns rätt"):
> **reporting is unconditional, the destination is capability-gated.** A row
> always states the file, its size, which ceiling it tripped and how many
> documents use it. Clicking it takes the first rung that exists:
> `openAsset` → a media tool detected via `useTools` → the file's own URL.
>
> **Explicitly rejected: building the migration ourselves** (upload a
> CDN-resized copy, repoint every reference). Doable — measured 272 KB → 107 KB
> on a real asset — but it reimplements the media plugin's riskiest operation,
> writes across drafts/published/release versions, and would still only ever
> serve images. It does not belong behind a row click.
>
> **Also shipped, beyond the plan:** per-media-kind size ceilings
> (`maxSizeBytes` now takes an object; one number for a JPEG, a print PDF and
> a podcast episode was the wrong shape), per-kind row categories
> ("Oversized image"/"Oversized PDF"), a `file` field and a real PDF fixture
> in `test-studio` so the `sanity.fileAsset` half is exercisable at all, and
> `sanity-plugin-media` installed there behind `SANITY_STUDIO_MEDIA_PLUGIN=1`
> so both capability states can actually be tested.
>
> **Two live bugs this found, neither visible in review:**
>
> - `usedBy._id` arrived draft-prefixed (`drafts.<id>`) because the Studio
>   client reads on a drafts-inclusive perspective, and Sanity's edit intent
>   cannot resolve a prefixed id — the row navigated nowhere, silently. Moot
>   now that field navigation is gone, but it is why `documentValidation`
>   strips the prefix.
> - `navigate({tool})` does nothing inside a structure pane: `useRouter()`
>   there is the structure tool's own **scoped** router. The click was
>   consumed and the URL never changed. Fixed with `navigateUrl({path:
>   '<basePath>/<tool>'}`).
>
> **Open, deliberately not fixed here:** `test-studio`'s three image assets
> report `size: 1118783` while the CDN serves 272 KB — a 4× disagreement
> between the field this source flags on and the bytes that actually ship.
> Worth its own look before anything automates a fix off that number.
>

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — read-only. This plan adds navigation and one extra query.
  It writes nothing, and touches no existing write path.
- **Depends on**: 059 (reuses `toFocusPath`, and the field-focus bar it set)
- **Category**: direction (feature) + docs (the "no safe open target" comment
  becomes half-true and must be rewritten, not left standing)
- **Planned at**: commit `a7442e7`, 2026-09-21

## Context — why this change

Reported by the maintainer, 2026-09-21, from a live Studio: an **Oversized
asset** row is a dead end. You can dismiss it, snooze it, assign it — you
cannot get to the thing it is about. In the same merged list, immediately
above it, a **Missing alt text** row opens the document on the offending
field (plan 059). Two rows, one list, one click, two completely different
outcomes, and nothing on the row explains why.

The existing behaviour is deliberate, not an oversight.
`src/inbox/sources/assetIssues.ts:381-386`:

> Oversized/unused rows have no `intent`: `sanity.imageAsset`/
> `sanity.fileAsset` are real document types but are deliberately excluded
> from Structure Tool's own default document-type handling [...] so there is
> no safe "open" target for one outside the Media browser.

**That reasoning is still true and is not being overturned.** Re-confirmed
against `sanity@6.13.0` while planning this: `sanity/media-library` exports
only `defineVideoField`, and there is no routable media tool and no
asset-targeting intent to navigate to. Nothing here should try to open a
`sanity.imageAsset` document.

What the comment missed is that **the asset is not the only destination**. You
do not fix an oversized image by opening the asset record; you fix it by
replacing the image in the document that uses it. That document is an ordinary
document, it has an ordinary `edit` intent, and — since 059 — this codebase
already knows how to land on one specific field inside it.

So: the row should go where the fix happens.

### The three cases, and where each one goes

A destination ladder, tried in order. Every rung degrades to the next, and
**rung 1 and rung 4 need no plugin at all** — a Studio with nothing but
`structureTool()` gets working navigation:

| # | Case | Destination | Mechanism |
| --- | --- | --- | --- |
| 1 | Asset used by ≥1 document | That document, focused on the image field | `intent: 'edit'` + `path` |
| 2 | Used, but field path unresolvable | That document, top of the form | `intent: 'edit'`, no `path` |
| 3 | Unused, and a media tool is installed | That tool | `openDetail` → `router.navigate({tool})` |
| 4 | Unused, no media tool | The asset file itself, new tab | `openDetail` → `window.open(url)` |

Rungs 3 and 4 are the honest ones. An unused asset has no document to open by
definition, and its real remedy is deletion — which core Studio gives no
target for, but a media browser does. So if one is installed, send the editor
where deleting is actually possible; if not, open the file, which is at least
the one thing a person can do with it right now (look at it, download it,
confirm it is junk). Both beat a click that does nothing.

### Media browsing is not guaranteed — detect it, never assume it

Raised by the maintainer mid-plan, and it is the right constraint: **a media
library is not something every Studio has.** There are two distinct things
wearing that name, and this plan must not depend on either:

1. **A community media plugin** (`sanity-plugin-media` and friends) —
   registers its own Studio tool that browses the dataset's own
   `sanity.imageAsset`/`sanity.fileAsset` documents. Exactly the documents
   this source already queries, so where it *is* installed it is the correct
   destination for an orphan.
2. **Sanity's own Media Library** — a separate product, and a separate
   resource: assets there are reached by `globalDocumentReference` with
   `resourceType: 'media-library'` (confirmed in `sanity@6.13.0`'s own
   bundled `sanity.video`/`sanity.image` type definitions), **not** stored as
   `sanity.imageAsset` in the dataset.

Consequence for (2), and it must be written down rather than discovered by a
user: assets that live in Sanity's Media Library are **invisible to this
source entirely** — the queries read the dataset, and those assets are not in
it. `assetIssues` is not broken on such a Studio; it simply has nothing to
report about library assets. Say so in the README. Do not attempt to widen
the queries to reach the library resource in this plan.

For (1), detect at runtime — do not add a dependency, do not add a peer
dependency, and do not check `package.json`:

```ts
const tools = useTools()
const mediaTool = useMemo(
  () => tools.find((tool) => MEDIA_TOOL_NAMES.has(tool.name)),
  [tools],
)
```

`useTools` is exported from `sanity` (verified against 6.13.0) and returns the
tools actually registered in this workspace. A `Set` of known names at module
scope (`'media'`, `'media-library'`) keeps the guesswork in one visible place.

**Do not fabricate a deep link into that tool.** Whether a given media plugin
accepts an asset id in its route is that plugin's business, is not documented
by anything in this repo, and cannot be verified here — it is not installed.
Navigate to the tool and stop. Landing an editor in the asset browser is a
truthful destination; landing them on a URL invented from a guessed route
shape is a broken one.

### And an escape hatch, for the Studios neither case fits

A new option, following the shape every other integrator hook in this source
already uses (`suggestAlt`, `describeImage`):

```ts
/** Where an asset row goes when no document uses the asset. Overrides the built-in tool/URL fallback. */
openAsset?: (asset: {id: string; type: string; url?: string; filename?: string}) => void
```

Present, it wins over rungs 3 and 4 outright. That is how a Studio with a
media browser this plugin has never heard of — or with Sanity's own Media
Library — routes these rows itself, without this repo having to enumerate
every asset tool that exists.

## Current state

`src/inbox/sources/assetIssues.ts:309-310` — neither query selects `url`, and
neither knows anything about who references the asset:

```ts
const OVERSIZED_QUERY = `*[_type in $assetTypes && size > $maxSizeBytes] | order(size desc)[0...$limit]{_id, originalFilename, size}`
const UNUSED_QUERY = `*[_type in $assetTypes && count(*[references(^._id)]) == 0] | order(size desc)[0...$limit]{_id, originalFilename, size}`
```

`src/inbox/sources/assetIssues.ts:513-533` — both row builders, with no
`intent` and no `subtitle` beyond the size:

```ts
for (const asset of oversized) {
  rows.push(
    withAssignee({
      id: `oversized:${asset._id}`,
      title: asset.originalFilename || asset._id,
      subtitle: formatAssetSize(asset.size),
      category: 'Oversized asset',
      tone: 'caution',
    }),
  )
}
```

`src/inbox/sources/documentValidation.ts:108` — `toFocusPath` already converts
a segment array (with `{_key}` objects) into the string Sanity's edit intent
wants, and is already exported.

`src/inbox/InboxRow.tsx:272-280` — click order is `intent` → `onEdit`
(which `MergedList.tsx:935` wires to `openDetail`) → select. A row with an
`intent` never reaches `openDetail`, so the two destinations cannot collide.

## Steps

### Step 1 — a walker that finds where an asset sits in a document

New exported function in `src/inbox/sources/assetIssues.ts`:

```ts
export function findAssetFieldSegments(value: unknown, assetId: string): unknown[] | null
```

Depth-first over plain objects and arrays. A node matches when it is an object
whose `asset` is an object with `_ref === assetId`. Return the path **to that
node**, not to its `asset` child — the image field is what the editor needs
focused; `hero`, not `hero.asset`.

Segment rules, matching `toFocusPath`'s input contract:

- object property → the key as a string
- array item with a `_key` → `{_key: item._key}`
- array item without a `_key` → **abort that branch and return `null` for it**.
  Do not fall back to a numeric index. `plans/059`'s own reasoning applies
  verbatim: an index silently points at the wrong item after a reorder, and a
  wrong focus target is worse than none.
- skip keys starting with `_` (no walking into `_type`/`_ref`/`_weak`)

Then `toFocusPath(segments)` produces the `path` param.

**Unit tests** (add to `src/inbox/sources/assetIssues.test.ts`):

- top-level image field → `'hero'`
- nested object → `'seo.ogImage'`
- keyed array item → `'blocks[_key=="a1b2"].image'`
- unkeyed array item → `null` (the whole lookup, not a partial path)
- asset id not present anywhere → `null`
- an object with `asset` but a different `_ref` → not a match

### Step 2 — teach both queries who uses the asset

```ts
const OVERSIZED_QUERY = `*[_type in $assetTypes && size > $maxSizeBytes] | order(size desc)[0...$limit]{_id, originalFilename, size, url, "usedBy": *[references(^._id)][0]{_id, _type}, "useCount": count(*[references(^._id)])}`
const UNUSED_QUERY = `*[_type in $assetTypes && count(*[references(^._id)]) == 0] | order(size desc)[0...$limit]{_id, originalFilename, size, url}`
```

Two things to be deliberate about:

1. **`count(*[references()])` is the exact pattern this file already calls out
   as slow** (`assetIssues.ts:33`, and the reason `UNUSED_ASSET_SCAN_LIMIT`
   exists at all). It is acceptable *here* and nowhere else in this file
   because the projection runs after `[0...$limit]` — at most `limit` (20)
   assets, not the whole library. Do not lift this projection onto an
   unsliced query.
2. `UNUSED_QUERY` gains only `url`. Its rows are unused by definition; asking
   for a reference count there would be paying twice for a known answer.

Extend `AssetRow` accordingly: `url?: string`, `usedBy?: {_id: string; _type: string}`, `useCount?: number`.

### Step 3 — resolve the focus path in one extra query

After the main fetch, collect the distinct `usedBy._id` values from the
oversized rows and fetch those documents in a single query:

```ts
const usingDocs = ids.length ? await client.fetch<Record<string, unknown>[]>(`*[_id in $ids]`, {ids}) : []
```

One query for the whole batch, capped at `limit` documents by construction.
Walk each with `findAssetFieldSegments` to build `Map<assetId, focusPath>`.

If this query throws, **do not fail the source** — catch it and continue with
no paths. The rows still navigate to the right document; they just land at the
top of the form. A missing focus path is a downgrade, not an error.

### Step 4 — put the destination on the row

Oversized row, when `usedBy` exists:

```ts
intent: {
  type: 'edit',
  params: {id: asset.usedBy._id, type: asset.usedBy._type, ...(focusPath ? {path: focusPath} : {})},
}
```

Subtitle gains the usage count, so the row says where the click will land
before you click it:

- `11.3 MB · used in 1 document`
- `11.3 MB · used in 3 documents`
- `11.3 MB · not used anywhere`

Unused rows keep their own `category` ("Unused asset") and do not need the
count restated — `formatAssetSize(asset.size)` alone stays their subtitle.

Per `MEMORY.md`'s own standing note on row consistency: this is a change to how
a row behaves on click, so check every row type this source emits
(oversized, unused, missing alt, poor alt) still reads coherently side by side
in one list, not just the one that prompted the work.

### Step 5 — `openDetail` for the orphans, down the whole ladder

A source-level `openDetail` that looks the row up in an id → asset map built
in the same `useMemo` pass as `items` (the same reason that memo already
builds `altTargets` in one pass: two views of one dataset drift the moment
they are computed apart).

```ts
const openDetail = useCallback(
  (item: InboxItem) => {
    const asset = assetsById.get(item.id)
    if (!asset) return
    if (openAsset) return openAsset(asset)
    if (mediaTool) return router.navigate({tool: mediaTool.name})
    if (asset.url) window.open(asset.url, '_blank', 'noopener,noreferrer')
  },
  [assetsById, openAsset, mediaTool, router],
)
```

Order is the ladder from the table, and each rung is a real capability check,
not a preference: the integrator's own override, then a tool that is actually
registered, then the file. A row whose asset has no `url` and no tool does
nothing — unchanged from today, and the only case left that does.

Add `openDetail` to the returned `useMemo` and its dependency list.
`assetsById` changes identity only when the fetch produces new data, exactly
like `altTargets` — this is the shape AGENTS.md's churn rule requires, and
`proposeFix` is the precedent to copy. Watch `router` in particular: if
`useRouter()`'s value is not referentially stable across renders this
callback churns, and churn in a reported result is the exact failure AGENTS.md
records three times. Verify it, and if it is unstable, hold it in a ref.

### Step 6 — rewrite the comment that is now half-true

`assetIssues.ts:381-386` currently states flatly that these rows have no
`intent`. After this change that is wrong for the common case. Rewrite it to
say what is *still* true and why the new behaviour is not a contradiction:
there is still no way to open a `sanity.imageAsset`, so the row opens the
document that uses it instead, and falls back to the file itself when nothing
does. AGENTS.md: "When you change behaviour here, fix the comment in the same
commit."

### Step 7 — docs

README, the `assetIssues` row of the source table and the asset section:

1. An asset row now navigates, and **where** it lands — the four-rung ladder,
   stated plainly, because "it depends on what you have installed" is only
   confusing when it is left implicit.
2. The new `openAsset` option, with the one-line reason it exists.
3. **Sanity's own Media Library is out of scope**: assets stored there are not
   dataset documents, so `assetIssues` reports nothing about them. This is the
   sentence most worth writing — a user on a Media Library Studio otherwise
   reads an empty asset section as a broken plugin.
4. Close the gap found while planning this: the table lists `maxSizeBytes` but
   never gives its default (5 MiB) or an example. Add both, and note that
   `formatAssetSize` divides by 1024, so a decimal `10_000_000` threshold
   prints as `9.5 MB`.

## Verification

```
npm run lint
npm run typecheck
npm test
npm run build
```

Then, live in `test-studio` (the studio consumes `dist/`, so the build above is
not optional — AGENTS.md):

1. An oversized asset used by a document → row click lands **in that document
   with the image field focused**. Confirm with `document.activeElement`, the
   same way 059 was verified. Do not report this step done from a screenshot
   of the right document alone; the field focus is the claim being made.
2. An oversized asset used by nothing, **no media tool installed** → row
   click opens the file in a new tab.
3. An unused asset row → same, opens the file.
4. Install a media plugin in `test-studio` (or register a throwaway tool named
   `media`) and repeat 2–3 → the row now lands in that tool instead. Then
   remove it and confirm the URL fallback comes back. Both halves matter:
   the whole point of this rung is that neither Studio is the assumed one.
5. Pass an `openAsset` callback in `test-studio`'s config → it wins over both,
   and the built-in fallbacks never fire.
6. Missing-alt and poor-alt rows → unchanged, still land on their own field.
7. Sit on the pane for a minute without touching it, watching for "Maximum
   update depth exceeded". This source now returns one more callback in its
   result; that is precisely the shape that has taken this pane down three
   times (AGENTS.md).

## STOP conditions

- `findAssetFieldSegments` would need to emit a numeric array index to produce
  a path. Return `null` instead and stop rather than "fixing" it.
- The reference-count projection measurably slows the source on a real
  library. Drop `useCount` and the subtitle text that needs it; keep the
  navigation, which only needs `usedBy`.
- Anything here starts wanting to open, patch or delete a `sanity.imageAsset`
  document directly. That is the boundary this plan explicitly does not cross.
- A media tool's internal route shape would have to be guessed to deep-link to
  one asset inside it. Navigate to the tool and stop.
- `sanity-plugin-media` or any other asset browser starts looking like a
  dependency, a peer dependency, or an import. It is a runtime detection and
  nothing more.
- The pane logs "Maximum update depth exceeded" at any point.

## Out of scope

- Deleting an unused asset from the Inbox. Real remedy, no safe target, and it
  is a destructive bulk action on a shared, project-wide resource — its own
  plan, with its own confirmation design.
- Compressing or resizing an oversized asset in place.
- Grouping one asset's multiple using-documents into sub-rows. The count in
  the subtitle is the honest minimum; `linkCheckerFindings`' grouping is the
  model if evidence ever asks for more.
- Reporting on assets held in Sanity's own Media Library. That is a different
  resource with a different API, and it is a plan of its own — not a widened
  query bolted onto this one.
