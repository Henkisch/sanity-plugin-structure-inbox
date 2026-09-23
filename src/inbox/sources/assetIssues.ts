import {ImageIcon} from '@sanity/icons/Image'
import {isDocumentSchemaType, isImageSchemaType} from '@sanity/types'
import {useToast} from '@sanity/ui/toast'
import {useCallback, useMemo, useRef} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
import {useClient, useSchema, useTranslation, useWorkspace} from 'sanity'
import {useRouter} from 'sanity/router'

import {API_VERSION, STRUCTURE_INBOX_NAMESPACE} from '../../constants'
import {toDisplayTitle} from '../../i18n/contentText'
import {
  documentLanguage,
  useContentLanguages,
  useContentWriteLanguage,
  useDocumentLanguageField,
} from '../../i18n/useContentLanguages'
import {isHiddenType} from '../AddMenu'
import {
  type FixProposal,
  type InboxItem,
  type InboxSource,
  type InboxSourceResult,
} from '../types'
import {targetIdFromItemId, useAssignmentCapability} from './assignmentCapability'
import {optionalHook, useSafely} from './capability'
import {liveQuery$} from './liveQuery'
import {SIMPLE_FIELD_PATH} from './simpleFieldPath'

/** Real image/file asset documents this project's own dataset holds. */
const ASSET_TYPES = ['sanity.imageAsset', 'sanity.fileAsset']

/**
 * Above this many total assets, `unused` is skipped (reports zero rows)
 * rather than run — Sanity's own documented recipe for finding orphaned
 * assets (`count(*[references(^._id)]) == 0`, per-asset) is a real,
 * reported source of slow queries on a large media library. Same
 * silently-absent-when-uncertain posture `needsAttention`/other sources
 * already use rather than risk it unconditionally.
 */
const UNUSED_ASSET_SCAN_LIMIT = 200

/**
 * The name of the sub-field whose own type is an image type — the
 * wrapper-object convention's inner field, name-agnostic — or `undefined`
 * when there is none. Returns the *name*, not a boolean, because the alt
 * text and the asset do not live at the same path on a wrapper object: alt
 * is at `<field>.<altFieldName>`, but the asset is at
 * `<field>.<thisName>.asset`. Getting that second path wrong is silent —
 * the projection just resolves to `null` — so the walk records it rather
 * than letting each query guess.
 */
function imageSubfieldName(
  fields: {name: string; type: WalkableSchemaType}[] | undefined,
): string | undefined {
  return fields?.find((sub) => isImageSchemaType(sub.type))?.name
}

/** The sub-field named `altFieldName`, if any — works the same whether `fields` came from a direct image type or a wrapper object type. */
function altSibling(
  fields: {name: string; type: WalkableSchemaType}[] | undefined,
  altFieldName: string,
): {name: string; type: WalkableSchemaType} | undefined {
  return fields?.find((sub) => sub.name === altFieldName)
}

/**
 * What an alt field stores, as far as reading and fixing it goes.
 *
 * - `string`: a plain string field — the only shape before localization was
 *   considered, and still the common one.
 * - `internationalizedArray`: `sanity-plugin-internationalized-array`'s
 *   `[{_key, _type, language, value}]`. Readable, and fixable by writing one
 *   entry — the plugin's own entry type is `<field type>Value`.
 * - `localized`: any other non-string shape (a `localeString` object, some
 *   other array). Readable through `toDisplayTitle`, never written: this
 *   source has no way to know that shape's write contract, and a plain
 *   string patched over it would corrupt the field.
 */
export type AltFieldShape = 'string' | 'internationalizedArray' | 'localized'

/** Exported for its own test. */
export function altFieldShape(type: WalkableSchemaType): AltFieldShape {
  if (type.name.startsWith('internationalizedArray') && type.jsonType === 'array') {
    return 'internationalizedArray'
  }
  if (type.jsonType === undefined || type.jsonType === 'string') return 'string'
  return 'localized'
}

interface EligibleImageField {
  documentType: string
  documentTypeTitle: string
  fieldName: string
  fieldTitle: string
  /**
   * Path from the document root to the image object itself — `fieldName` for
   * a direct image field, `fieldName.subfield` for the wrapper-object
   * pattern. Alt text lives at `<fieldName>.<altFieldName>` either way, but
   * the asset does not, which is the whole reason this is tracked
   * separately.
   */
  imagePath: string
  /** How the alt sub-field stores its text — see {@link AltFieldShape}. */
  altShape: AltFieldShape
  /** The alt sub-field's own schema type name — an internationalized array's entries are `<this>Value`. */
  altTypeName: string
}

/**
 * The minimal shape this walk actually reads off a schema type — loose
 * rather than the real `Schema`/`SchemaType`, the same reasoning
 * `contentGapsDigest.ts`'s own `getRealDocumentTypeNames` gives for doing
 * the same: a real schema type satisfies this trivially (structural
 * typing), but `isDocumentSchemaType`/`isImageSchemaType` only care about
 * this much, and a test fixture only needs to build this much, not the
 * full real union.
 */
interface WalkableSchemaType {
  name: string
  title?: string
  /** Absent on hand-built test fixtures, which the walk treats as a plain string field. */
  jsonType?: string
  type?: WalkableSchemaType
  fields?: {name: string; type: WalkableSchemaType}[]
}

/**
 * Every top-level image field, on every real project document type, that
 * also declares its own `altFieldName` sub-field — walked once from
 * `useSchema()`, the same "real project type" filter (`isHiddenType`,
 * `isDocumentSchemaType`) `AddMenu.tsx`'s own "new content" menu already
 * uses. Not schema-agnostic in general: alt text lives on the *referencing
 * document's* image field, not the asset itself, so this has to be found
 * per document type rather than queried off the asset. Recognizes two
 * schema conventions: the field's own type customizing `image` directly
 * (Sanity's own recommended pattern), or the field's type being a separate
 * reusable wrapper object (e.g. `imageWithAlt`) that itself contains an
 * image sub-field alongside the alt sub-field — both produce the identical
 * result shape, since the alt text lives at the same JSON path either way.
 * Top-level fields only, v1 — an image nested inside an object or array
 * isn't walked. Exported for its own test.
 */
export function findAltEligibleImageFields(
  schema: {getTypeNames: () => string[]; get: (name: string) => WalkableSchemaType | undefined},
  altFieldName: string,
): EligibleImageField[] {
  const results: EligibleImageField[] = []

  for (const typeName of schema.getTypeNames()) {
    if (isHiddenType(typeName)) continue
    const type = schema.get(typeName)
    if (!type || !isDocumentSchemaType(type)) continue

    // `type.fields` can be genuinely absent — the schema's own abstract
    // `document` base type passes `isDocumentSchemaType` (its `.name` is
    // literally `"document"`) but declares no concrete fields of its own;
    // confirmed live against the real test-studio schema, which is
    // exactly where this crashed before the fallback was added.
    for (const field of type.fields ?? []) {
      // eslint-disable-next-line no-unsafe-type-assertion -- against the real `Schema`, `field.type` is a wide union of every schema type kind (most without a `.fields` property at all); `isImageSchemaType`'s own guard only collapses that union when used directly in an `if`, which the wrapper-object OR below can't do, so re-assert this walk's own loose shape once here instead.
      const fieldType = field.type as unknown as WalkableSchemaType
      const isDirectImage = isImageSchemaType(fieldType)
      const subfield = isDirectImage ? undefined : imageSubfieldName(fieldType.fields)
      if (!isDirectImage && !subfield) continue
      const alt = altSibling(fieldType.fields, altFieldName)
      if (!alt) continue
      // Guards the GROQ interpolation below (`assetIssues`'s missing-/poor-alt
      // queries splice `field.fieldName` and `imagePath` straight into the
      // query string) — a real Sanity field name is already restricted to a
      // safe identifier shape at schema-definition time, so this is a
      // defensive skip, not a check expected to ever actually reject a
      // genuine schema field. The wrapper's inner field name reaches GROQ the
      // same way, so it gets the same guard.
      if (!SIMPLE_FIELD_PATH.test(field.name)) continue
      if (subfield && !SIMPLE_FIELD_PATH.test(subfield)) continue

      results.push({
        documentType: typeName,
        documentTypeTitle: type.title || typeName,
        fieldName: field.name,
        fieldTitle: fieldType.title || field.name,
        imagePath: subfield ? `${field.name}.${subfield}` : field.name,
        altShape: altFieldShape(alt.type),
        altTypeName: alt.type.name,
      })
    }
  }

  return results
}

/** `1234567` → `"1.2 MB"` — good enough for a row's own subtitle, not a precise byte count. */
export function formatAssetSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export type AltTextIssue = 'filenameLike' | 'placeholder' | 'tooShort'

/** Alt text is one sentence; anything past this is a model that misunderstood the job. */
const MAX_ALT_LENGTH = 300

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

/**
 * What a suggestion callback is told about the image it is being asked to
 * describe. `documentType` and `fieldName` are the two that let an
 * integrator branch per kind of image.
 *
 * @public
 */
export interface AltContext {
  documentId: string
  documentType: string
  fieldName: string
  /**
   * The document's own title/name/label — absent when it has none. On a
   * localized document, the text in `language` when that's set, and in the
   * editor's preferred content language otherwise.
   */
  title?: string
  /**
   * The content language the alt text will be written in — set only for a
   * localized alt field, and then always the first of the plugin's own
   * `i18n.languages`. Describe the image in this language.
   */
  language?: string
}

/**
 * Size ceilings per kind of media, because these are not comparable numbers.
 *
 * Sanity's dataset has exactly two asset document types —
 * `sanity.imageAsset` and `sanity.fileAsset` — and `fileAsset` is *everything
 * else*: PDFs, audio, video, archives, fonts. (`sanity.videoAsset` exists but
 * belongs to Sanity's Media Library, a separate resource this source cannot
 * see.) So the kind has to come from `mimeType`, not from the document type.
 */
export interface MaxAssetSizes {
  /** `sanity.imageAsset`. Defaults to 5 MiB — past that a web image has almost certainly skipped a resize. */
  image?: number
  /** `video/*`. Defaults to 200 MiB: video is inherently large, and flagging it at image thresholds is just noise. */
  video?: number
  /** `audio/*`. Defaults to 30 MiB — roughly a half-hour episode at a sane bitrate. */
  audio?: number
  /** `application/pdf`. Defaults to 15 MiB; a print-ready PDF is legitimately heavy. */
  pdf?: number
  /** Any other file asset — archives, documents, fonts. Defaults to 25 MiB. */
  other?: number
}

const DEFAULT_MAX_SIZES: Required<MaxAssetSizes> = {
  image: 5 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  pdf: 15 * 1024 * 1024,
  other: 25 * 1024 * 1024,
}

/**
 * The asset an unreferenced row is about, as handed to `openAsset`.
 *
 * @public
 */
export interface AssetTarget {
  id: string
  type: string
  url?: string
  filename?: string
  size: number
}

/**
 * @public
 */
export interface AssetIssuesOptions {
  /** Cap on rows per check (oversized, unused, missing alt text — each capped independently). Defaults to 20. */
  limit?: number
  /** Row category label. Defaults to a translated "Asset issues"; a custom value is shown exactly as given. */
  title?: string
  /**
   * What counts as oversized, per kind of media.
   *
   * One ceiling for everything is the wrong shape and was the original
   * mistake here: 4 MB is an alarming JPEG, an unremarkable PDF, a short
   * podcast episode and a tiny video. A single number made the check either
   * noisy for documents or blind to images.
   *
   * Pass an object to set them separately, or a plain number to apply one
   * ceiling to every kind (the old behaviour, kept working on purpose).
   * Anything you leave out keeps its default.
   */
  maxSizeBytes?: number | MaxAssetSizes
  /**
   * Where an asset row goes when no document uses the asset — an unused
   * asset, or an oversized orphan.
   *
   * There is nothing to open by default: `sanity.imageAsset` is excluded
   * from Structure Tool's own document-type handling, and a media browser is
   * a plugin, not a given. Left unset, the row falls back to a media tool
   * registered in this workspace if there is one, and to opening the file in
   * a new tab if there isn't.
   *
   * Set this to route those rows yourself — into Sanity's own Media Library,
   * or into whichever asset browser your Studio actually has.
   */
  openAsset?: (asset: AssetTarget) => void
  /** The sub-field name on an image field that holds its alt text. Defaults to `'alt'`. */
  altFieldName?: string
  /**
   * `'<documentType>.<fieldName>'` pairs whose image depicts the document's
   * own subject — a person's portrait, a product's pack shot. For those, the
   * document's own title *is* the correct alt text, so the Inbox can fill it
   * in with no model call and no cost, one row or a whole selection at a
   * time.
   *
   * Deliberately declared rather than guessed: an article's hero image is not
   * a picture of its headline, and a wrong alt text is worse than a missing
   * one because nothing ever flags it again.
   *
   * The title is written verbatim, with no "Photo of"/"Porträtt av" prefix —
   * WAI guidance is that assistive technology already announces that it is an
   * image, so a prefix is redundant noise. Use `suggestAlt` if you want one
   * anyway.
   */
  altFromTitle?: string[]
  /**
   * Full control over the deterministic answer, and it wins over
   * `altFromTitle`. Return `null` for "no safe answer here" — that row stays
   * unfixable rather than getting a guess.
   *
   * Synchronous and free on purpose: this is what the bulk action applies, so
   * it must not do I/O. Anything that costs money or time belongs in
   * `describeImage`.
   *
   * Captured once when `assetIssues()` is called, so it does not need to be
   * memoized — but it is read on every rebuild of the item list, so keep it
   * cheap and free of side effects.
   */
  suggestAlt?: (ctx: AltContext) => string | null
  /**
   * Describe an image this plugin has no safe answer for, using your own
   * vision model.
   *
   * There is deliberately no built-in fallback here: Sanity's Agent Actions
   * cannot see images — its `instructionParams` accept only `constant`,
   * `field`, `document` and `groq` — so a built-in path could only guess at
   * the picture from the document's text, which produces confident, wrong alt
   * text. A wrong alt text is worse than a missing one, because the missing
   * one comes back to this inbox and the wrong one never does.
   *
   * Runs only when an editor clicks the fix action on one specific row. Never
   * on render, never on selection, and never from the bulk action — whatever
   * this costs you, it is charged one deliberate click at a time.
   * `ctx.documentType` and `ctx.fieldName` let you prompt differently per
   * kind of image.
   *
   * Return `null` when the model cannot describe it confidently.
   */
  describeImage?: (ctx: AltContext & {imageUrl: string}) => Promise<string | null>
}

/**
 * The deterministic half of the alt-text fix: what this plugin is willing to
 * write without asking anyone. `null` means "no safe answer" — that row stays
 * a link to the document rather than getting a guess.
 *
 * Exported for its own test, like `classifyAltText` and
 * `normalizeForComparison` beside it — not integrator-facing, unlike the
 * `suggestAlt`/`describeImage` callbacks in {@link AssetIssuesOptions} it
 * backs.
 *
 * @internal
 */
export function suggestAltText(
  ctx: AltContext,
  options: Pick<AssetIssuesOptions, 'altFromTitle' | 'suggestAlt'>,
): string | null {
  const fromCallback = options.suggestAlt?.(ctx)
  // A supplied callback speaks once and its answer is final: anything other
  // than `undefined` is its decision, including `null` and `''`. That is
  // exactly why this isn't the `??` chain it otherwise wants to be — a
  // callback written as `doc.caption ?? ''` must not silently inherit the
  // `altFromTitle` default for every document without a caption. Only a
  // callback that wasn't supplied at all falls through.
  if (fromCallback !== undefined) return fromCallback?.trim() || null

  if (!options.altFromTitle?.includes(`${ctx.documentType}.${ctx.fieldName}`)) return null
  return ctx.title?.trim() || null
}

interface AssetRow {
  _id: string
  _type: string
  originalFilename?: string
  size: number
  /** The file itself — the last rung of the ladder `openDetail` walks down. */
  url?: string
  /** How many documents use this asset. Subtitle context only; it is not where the row navigates. */
  useCount?: number
  /** The only thing distinguishing a PDF from an MP3 from a zip: all three are `sanity.fileAsset`. */
  mimeType?: string
}

/** Normalizes either option shape into one ceiling per kind. */
export function resolveMaxSizes(option: number | MaxAssetSizes | undefined): Required<MaxAssetSizes> {
  if (typeof option === 'number') {
    return {image: option, video: option, audio: option, pdf: option, other: option}
  }
  return {...DEFAULT_MAX_SIZES, ...option}
}

/** Which ceiling applies to an asset — the same split the query does, for labelling a row. */
export function assetKind(
  type: string,
  mimeType: string | undefined,
): keyof Required<MaxAssetSizes> {
  if (type === 'sanity.imageAsset') return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'other'
}

/** Row category per kind, so a row says which ceiling it tripped rather than a flat "Oversized asset". */
const OVERSIZED_CATEGORY: Record<keyof Required<MaxAssetSizes>, string> = {
  image: 'Oversized image',
  video: 'Oversized video',
  audio: 'Oversized audio',
  pdf: 'Oversized PDF',
  other: 'Oversized file',
}

// One filter per kind rather than one `size > $max`, because a ceiling that
// suits a JPEG does not suit a print PDF or a podcast episode. The kind comes
// from `mimeType` for file assets: the dataset has only `sanity.imageAsset`
// and `sanity.fileAsset`, and the latter covers PDFs, audio, video, archives
// and everything else alike.
//
// `count(*[references()])` is the exact shape this file's own
// `UNUSED_ASSET_SCAN_LIMIT` exists to keep off large libraries. It is
// affordable *here* only because the projection runs after `[0...$limit]`,
// so it costs at most `limit` (20) reference lookups rather than one per
// asset in the dataset. Do not lift this projection onto an unsliced query.
const OVERSIZED_QUERY = `*[_type in $assetTypes && (
  (_type == "sanity.imageAsset" && size > $maxImage) ||
  (_type == "sanity.fileAsset" && mimeType match "video/*" && size > $maxVideo) ||
  (_type == "sanity.fileAsset" && mimeType match "audio/*" && size > $maxAudio) ||
  (_type == "sanity.fileAsset" && mimeType == "application/pdf" && size > $maxPdf) ||
  (_type == "sanity.fileAsset" && !(mimeType match "video/*") && !(mimeType match "audio/*") && mimeType != "application/pdf" && size > $maxOther)
)] | order(size desc)[0...$limit]{_id, _type, originalFilename, size, url, mimeType, "useCount": count(*[references(^._id)])}`
// No `useCount` here: these rows are the ones nothing references, so asking
// would be paying a second time for an answer the filter already gave.
const UNUSED_QUERY = `*[_type in $assetTypes && count(*[references(^._id)]) == 0] | order(size desc)[0...$limit]{_id, _type, originalFilename, size, url, mimeType}`
const ASSET_COUNT_QUERY = `count(*[_type in $assetTypes])`

interface MissingAltRow {
  _id: string
  /** `unknown`, not `string`: a localized title is an array or an object — see `toDisplayTitle`. */
  title: unknown
  /**
   * The document's own title/name/label, *without* the `_id` fallback
   * `title` carries. `title` is display text and is always a string; this is
   * the only one a fix is allowed to write, because `alt="person-a1b2c3"` is
   * worse than no alt text at all.
   */
  safeTitle?: unknown
  /** The image asset's CDN url, for `describeImage`. Absent when the field holds no asset. */
  imageUrl?: string
  _updatedAt?: string
  /** Document-level translation's language — see `LANGUAGE_PROJECTION`. */
  language?: unknown
}

interface PoorAltRow {
  _id: string
  title: unknown
  _updatedAt?: string
  /** A string on a plain alt field; an array or an object on a localized one. */
  alt: unknown
  language?: unknown
  assetFilename?: string
}

/**
 * A document-level translation's language, by a parameterised field name so
 * the query text doesn't change with it; `null` when that isn't in use.
 */
const LANGUAGE_PROJECTION = `"language": select(defined($languageField) => @[$languageField])`

/**
 * The GROQ condition for "this image has no alt text", per alt field shape.
 * For an internationalized array that is "no entry has any text, in any
 * language" — not "none in the preferred language": that would be a
 * translation-coverage check, and on a Studio whose UI locale isn't a content
 * language at all it would flag every image in the dataset. Both path
 * segments are `SIMPLE_FIELD_PATH`-guarded by the schema walk, like every
 * other interpolation in this file.
 */
function missingAltFilter(field: EligibleImageField, altFieldName: string): string {
  const path = `${field.fieldName}.${altFieldName}`
  if (field.altShape === 'internationalizedArray') {
    return `(!defined(${path}) || count(${path}[defined(value) && value != ""]) == 0)`
  }
  return `!defined(${path})`
}

/** Distinct row `category` text per `AltTextIssue` kind — three separate findings, not one vague bucket. */
const ALT_ISSUE_CATEGORY: Record<AltTextIssue, string> = {
  filenameLike: 'Alt text looks like a filename',
  placeholder: 'Generic alt text',
  tooShort: 'Alt text too short',
}

/**
 * Everything `proposeFix` needs about one missing-alt row, keyed by the row's
 * own id — the same lookup-by-id shape `linkCheckerFindings`'s `findingsByKey`
 * uses, and for the same reason: a row id is a string, and `proposeFix` is
 * handed back the item, not the query result it came from.
 */
interface AltTarget extends AltContext {
  imageUrl?: string
  altShape: AltFieldShape
  altTypeName: string
  /** Non-null exactly when a deterministic answer exists — this is what makes a row quick-fixable. */
  suggestion: string | null
}

function toAssetTarget(asset: AssetRow): AssetTarget {
  return {
    id: asset._id,
    type: asset._type,
    url: asset.url,
    filename: asset.originalFilename,
    size: asset.size,
  }
}

/**
 * `oversized`/`unused` row ids are `` `oversized:${asset._id}` ``/`` `unused:${asset._id}` ``
 * — the prefix already says which kind of row this is, so `openDetail`'s
 * toast wording doesn't need a separate field threaded onto `AssetTarget`.
 */
function assetRowKind(id: string): 'oversized' | 'unused' | undefined {
  if (id.startsWith('oversized:')) return 'oversized'
  if (id.startsWith('unused:')) return 'unused'
  return undefined
}

/**
 * The row says where the click lands before it is clicked — "used in 3
 * documents" and "not used anywhere" go to visibly different places.
 */
export function describeUsage(useCount: number | undefined): string {
  if (!useCount) return 'not used anywhere'
  return useCount === 1 ? 'used in 1 document' : `used in ${useCount} documents`
}

/**
 * Tool names known to browse dataset assets. Detection, not a dependency:
 * `sanity-plugin-media` and friends are plugins a Studio may or may not
 * have, and this source must work either way.
 */
const MEDIA_TOOL_NAMES = new Set(['media', 'media-library'])

/** Stable empty list — a fresh array per render would re-run every memo below it. */
const NO_TOOLS: {name: string}[] = []

// `useTools` is `@hidden`/`@beta` in Sanity's own typings, so it goes through
// `optionalHook` like every other unstable API this plugin touches — a named
// import would take the whole barrel down the day it is renamed.
const useTools = optionalHook<() => {name: string}[]>('useTools', () => NO_TOOLS)

interface AssetIssuesFetch {
  oversized: AssetRow[]
  unused: AssetRow[]
  missingAlt: MissingAltRow[][]
  poorAlt: PoorAltRow[][]
  loading?: boolean
  error?: Error
}

/**
 * Unused, oversized, missing-alt-text, and poor-alt-text (filename-like,
 * generic, or too short — via `classifyAltText`) image/file assets — none
 * of which Sanity's own Structure Tool or Media library surfaces in
 * aggregate. No `resolve`: an oversized or unused asset is fixed by editing
 * the asset itself, the same reasoning `documentValidation` already uses for a
 * schema validation error — acknowledge-only.
 *
 * Missing alt text is the exception, and the only one: where the image
 * demonstrably depicts the document's own subject (`altFromTitle`), the
 * correct alt text is already sitting in that document's title, so the row
 * offers to write it — free, instantly, and for a whole selection at once.
 * Anything less mechanical than that needs eyes on the actual picture, which
 * is what the integrator's own `describeImage` is for; this source ships no
 * model of its own.
 *
 * Asset rows report unconditionally and navigate conditionally, which is
 * worth keeping written down because the constraint behind it is not obvious:
 *
 * - `sanity.imageAsset`/`sanity.fileAsset` are real document types that
 *   Structure Tool deliberately excludes from its own default document-type
 *   handling, so **there is no way to open an asset document itself** — do
 *   not add one.
 * - Sanity's own "Open in Source" cannot help either: the dataset asset
 *   sources (`createDatasetImageAssetSource`/`…FileAssetSource`) ship no
 *   `openInSource`, so it declines every dataset asset. Only the Media
 *   Library source implements it, for assets this source cannot see.
 * - The one native asset manager — list, Show usage, Delete — is the
 *   `DatasetAssetSource` browse dialog, rendered by the `@internal`
 *   `AssetSourceDialog`, and only ever from inside an image/file *input*.
 * - Assets are immutable anyway: the `_id` embeds a hash of the bytes, so
 *   "replace this file" exists nowhere. `sanity-plugin-media`'s Replace is a
 *   reference migration across every referencing document, images only.
 *
 * So these rows do not pretend to fix anything. They state what the file is,
 * how big it is, which ceiling it tripped and how many documents use it —
 * always — and clicking one takes the first destination that exists in this
 * Studio (`openDetail`): the integrator's own `openAsset`, then a media tool
 * actually registered in this workspace (a media browser is a plugin, not a
 * given), then the file itself in a new tab.
 *
 * The media-tool rung can only ever open the tool's own root, never the
 * specific asset — no media browser plugin exposes a route or param an
 * outside caller can address for this (checked `sanity-plugin-media`'s
 * bundled source directly). So that rung also copies the asset's filename to
 * the clipboard and toasts what to do with it: paste it into the tool's own
 * search, then use its Replace (or, for an unused asset, delete it there) —
 * the only path that actually fixes the asset for every document that
 * references it, which a field-level fix cannot do (see below).
 *
 * An earlier version sent these rows into the document using the asset, with
 * the image field focused. It was removed on maintainer feedback — landing on
 * a field is not "going to the asset" — and could not have served an unused
 * asset at all, which has no such document. See `plans/060`. It was
 * reconsidered once more here, this time because the actual goal turned out
 * to be replace/edit rather than viewing — but a field-level fix only swaps
 * one document's reference, leaving the oversized file itself untouched
 * everywhere else it's used. Still the wrong destination for these rows.
 *
 * Missing- and poor-alt-text rows are different in kind: those are on a real,
 * ordinary document, and keep the `'edit'` intent they have always had.
 *
 * @public
 */
export function assetIssues(options: AssetIssuesOptions = {}): InboxSource {
  const {
    limit = 20,
    title = 'source.assetIssues.defaultTitle',
    maxSizeBytes,
    openAsset,
    altFieldName = 'alt',
    altFromTitle,
    suggestAlt,
    describeImage,
  } = options

  const maxSizes = resolveMaxSizes(maxSizeBytes)

  if (!SIMPLE_FIELD_PATH.test(altFieldName)) {
    throw new Error(
      `[sanity-plugin-structure-inbox] assetIssues: altFieldName must be a plain field name, got "${altFieldName}"`,
    )
  }

  return {
    name: 'assetIssues',
    title,
    icon: ImageIcon,
    placement: 'main',
    // A media library is a shared, project-wide resource, not one editor's — same reasoning `documentValidation` uses for a draft's own validation state.
    audience: 'everyone',

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      // "Who's fixing this" — a task like any other, delegable even though
      // an asset (unlike a draft) can be referenced by zero or many
      // documents, so there's no single natural owner to fall back to.
      // Same shared record every assignable source writes through. `item.id`
      // is already this source's own row id (see `withAssignee` below) — see
      // `assignmentCapability.ts`'s own doc comment on `targetIdFromItemId`.
      const {assigneesById, byTarget, assign} = useAssignmentCapability(client, {
        targetId: targetIdFromItemId,
      })

      // `useToast` throws with no mounted `ToastProvider` — true of some of
      // this source's own `renderHook`-driven tests — so it goes through
      // `useSafely` like every other capability this source can't assume.
      const toast = useSafely(useToast, undefined)
      const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

      const altEligibleFields = useMemo(() => findAltEligibleImageFields(schema, altFieldName), [schema])
      const languages = useContentLanguages()
      const writeLanguage = useContentWriteLanguage()
      const languageField = useDocumentLanguageField()

      // Both of these throw rather than return a fallback when their context
      // isn't mounted (`Could not find \`source\` context`, `Router: missing
      // context value`), and both throw from a plain `if (!ctx) throw` after
      // their single `useContext` has already returned — the exact shape
      // `useSafely`'s own doc comment says is safe to wrap. A source rendered
      // outside a Studio router loses the media-tool rung of the ladder and
      // keeps every other one.
      const tools = useSafely(useTools, NO_TOOLS)
      const router = useSafely(useRouter, null)
      const basePath = useSafely(useWorkspace, undefined)?.basePath ?? ''

      // `navigateUrl` with an absolute path, deliberately not
      // `navigate({tool})`. Inside a structure pane `useRouter()` is the
      // structure tool's own *scoped* router, so a tool-level state change
      // means nothing there: verified live — the call was made, the click
      // consumed, and the URL never changed. An absolute path escapes the
      // scope, and it is the same path Sanity's own tool links use
      // (`<basePath>/<tool name>`).
      //
      // Held in a ref, not a dependency: the router context value is rebuilt
      // whenever router state changes — including on navigations this very
      // source triggers — and `openDetail` below is part of the result this
      // source reports upward, where a changing identity is a re-render
      // (AGENTS.md, three times over).
      const navigateUrlRef = useRef(router?.navigateUrl)
      navigateUrlRef.current = router?.navigateUrl

      const mediaToolName = useMemo(
        () => tools.find((tool) => MEDIA_TOOL_NAMES.has(tool.name))?.name,
        [tools],
      )

      const fetch$ = useMemo(() => {
        const params = {
          assetTypes: ASSET_TYPES,
          limit,
          maxImage: maxSizes.image,
          maxVideo: maxSizes.video,
          maxAudio: maxSizes.audio,
          maxPdf: maxSizes.pdf,
          maxOther: maxSizes.other,
        }

        const read$ = defer(() =>
          from(
            (async () => {
              const [oversized, assetCount, missingAlt, poorAlt] = await Promise.all([
                client.fetch<AssetRow[]>(OVERSIZED_QUERY, params),
                client.fetch<number>(ASSET_COUNT_QUERY, params),
                Promise.all(
                  altEligibleFields.map((field) =>
                    client.fetch<MissingAltRow[]>(
                      `*[_type == $type && defined(${field.fieldName}) && ${missingAltFilter(field, altFieldName)}] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), "safeTitle": coalesce(title, name, label), "imageUrl": ${field.imagePath}.asset->url, _updatedAt, ${LANGUAGE_PROJECTION}}`,
                      {type: field.documentType, limit, languageField: languageField?.field ?? null},
                    ),
                  ),
                ),
                Promise.all(
                  altEligibleFields.map((field) =>
                    client.fetch<PoorAltRow[]>(
                      `*[_type == $type && defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt, "alt": ${field.fieldName}.${altFieldName}, "assetFilename": ${field.imagePath}.asset->originalFilename, ${LANGUAGE_PROJECTION}}`,
                      {type: field.documentType, limit, languageField: languageField?.field ?? null},
                    ),
                  ),
                ),
              ])

              const unused =
                assetCount <= UNUSED_ASSET_SCAN_LIMIT
                  ? await client.fetch<AssetRow[]>(UNUSED_QUERY, params)
                  : []

              return {oversized, unused, missingAlt, poorAlt}
            })(),
          ),
        ).pipe(
          // The `map` to `AssetIssuesFetch` now lives inside `read$` itself,
          // not after `liveQuery$` — so `onFetchError`'s empty result and a
          // successful fetch's mapped result are the same shape by the time
          // either reaches `startWith`/`catchError` below.
          map((result): AssetIssuesFetch => ({...result, loading: false})),
        )

        // Any change to an asset or an eligible document type could add,
        // remove, or fix a finding — refetch everything rather than try to
        // patch one check's own result in place.
        const listenTypes = [...ASSET_TYPES, ...altEligibleFields.map((f) => f.documentType)]
        return liveQuery$(client, `_type in $types`, {types: listenTypes}, read$, (error) => ({
          oversized: [],
          unused: [],
          missingAlt: [],
          poorAlt: [],
          error,
        })).pipe(
          startWith<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], poorAlt: [], loading: true}),
          catchError((error: Error) =>
            of<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], poorAlt: [], error}),
          ),
        )
        // `maxSizes` is resolved once in the source factory, above `useItems`,
        // so it is a constant for this source's whole lifetime and correctly
        // absent here — which also means an integrator writing
        // `maxSizeBytes: {image: 1e6}` inline in their config cannot cause a
        // refetch loop with a fresh object identity per render (AGENTS.md).
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `altEligibleFields` is a derived, memoized array (schema is stable for this pane's lifetime); re-running this on every render it appears in would defeat the memoization the schema walk is already doing.
      }, [client, limit, languageField])

      const {oversized, unused, missingAlt, poorAlt, loading, error} = useObservable(fetch$, {
        oversized: [] as AssetRow[],
        unused: [] as AssetRow[],
        missingAlt: [] as MissingAltRow[][],
        poorAlt: [] as PoorAltRow[][],
        loading: true,
      })

      const withAssignee = (row: InboxItem): InboxItem => {
        const assignedTo = byTarget.get(row.id)
        const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
        return assignee ? {...row, assignee} : row
      }

      // `items` and the fix's own lookup table are built in one pass, and
      // deliberately share a `useMemo`: they are two views of the same rows,
      // and computing them apart is how they drift — a row advertising
      // `quickFixable` that `proposeFix` then can't find anything for.
      const {items, altTargets, assetsById} = useMemo(() => {
        const rows: InboxItem[] = []
        const targets = new Map<string, AltTarget>()
        const assets = new Map<string, AssetTarget>()

        for (const asset of oversized) {
          const id = `oversized:${asset._id}`
          assets.set(id, toAssetTarget(asset))
          rows.push(
            withAssignee({
              id,
              title: asset.originalFilename || asset._id,
              subtitle: `${formatAssetSize(asset.size)} · ${describeUsage(asset.useCount)}`,
              category: OVERSIZED_CATEGORY[assetKind(asset._type, asset.mimeType)],
              tone: 'caution',
            }),
          )
        }

        for (const asset of unused) {
          const id = `unused:${asset._id}`
          assets.set(id, toAssetTarget(asset))
          rows.push(
            withAssignee({
              id,
              title: asset.originalFilename || asset._id,
              subtitle: formatAssetSize(asset.size),
              category: 'Unused asset',
              tone: 'caution',
            }),
          )
        }

        for (const [index, fieldMissingAlt] of missingAlt.entries()) {
          const field = altEligibleFields[index]
          if (!field) continue
          // A localized alt field is only writable in a language the
          // integrator named (`useContentWriteLanguage`), and a non-array
          // localized shape not at all — see `AltFieldShape`. Such a row still
          // shows and still opens the document; it just offers no fix.
          const writable =
            field.altShape === 'string' ||
            (field.altShape === 'internationalizedArray' && writeLanguage !== undefined)
          const language = field.altShape === 'string' ? undefined : writeLanguage
          for (const doc of fieldMissingAlt) {
            const id = `missingAlt:${doc._id}:${field.fieldName}`
            const ctx: AltContext = {
              documentId: doc._id,
              documentType: field.documentType,
              fieldName: field.fieldName,
              // Writing in one specific language wants the title in that
              // language or nothing — a Swedish alt text copied from the
              // English title is wrong, not approximately right.
              title:
                (language
                  ? toDisplayTitle(doc.safeTitle, [language], {strict: true})
                  : toDisplayTitle(doc.safeTitle, languages)) ?? undefined,
              ...(language ? {language} : {}),
            }
            const suggestion = writable ? suggestAltText(ctx, {altFromTitle, suggestAlt}) : null

            if (writable) {
              targets.set(id, {
                ...ctx,
                imageUrl: doc.imageUrl,
                suggestion,
                altShape: field.altShape,
                altTypeName: field.altTypeName,
              })
            }

            const docLanguage = documentLanguage(languageField, field.documentType, doc.language)
            rows.push(
              withAssignee({
                ...(docLanguage ? {language: docLanguage} : {}),
                id,
                title: toDisplayTitle(doc.title, languages) ?? doc._id,
                subtitle: `${field.documentTypeTitle} · ${field.fieldTitle}`,
                category: 'Missing alt text',
                tone: 'caution',
                timestamp: doc._updatedAt,
                changedAt: doc._updatedAt,
                // The alt field's own path, which is the same string
                // `proposeFix` patches — so "open this" and "fix this" can
                // never disagree about which field the row is about. Both
                // segments are `SIMPLE_FIELD_PATH`-guarded and top-level, so
                // there is no keyed array segment to get wrong here.
                intent: {
                  type: 'edit',
                  params: {
                    id: doc._id,
                    type: field.documentType,
                    path: `${field.fieldName}.${altFieldName}`,
                  },
                },
                // Only ever `true` where there is a real answer waiting: a
                // deterministic one this plugin can write for free, or an
                // image an integrator's own model could be asked about.
                quickFixable: suggestion !== null,
                fixable: suggestion !== null || (writable && Boolean(describeImage && doc.imageUrl)),
              }),
            )
          }
        }

        for (const [index, fieldPoorAlt] of poorAlt.entries()) {
          const field = altEligibleFields[index]
          if (!field) continue
          for (const doc of fieldPoorAlt) {
            // A plain string is classified as-is, `''` included (that's
            // `tooShort`, as it always was). A localized value is classified
            // in the preferred language; one with no text at all is the
            // missing-alt check's row, not this one's.
            const altText = typeof doc.alt === 'string' ? doc.alt : toDisplayTitle(doc.alt, languages)
            if (altText === null) continue
            const issue = classifyAltText(altText, doc.assetFilename)
            if (!issue) continue
            const docLanguage = documentLanguage(languageField, field.documentType, doc.language)
            rows.push(
              withAssignee({
                ...(docLanguage ? {language: docLanguage} : {}),
                id: `poorAlt:${doc._id}:${field.fieldName}`,
                title: toDisplayTitle(doc.title, languages) ?? doc._id,
                subtitle: `${field.documentTypeTitle} · ${field.fieldTitle}`,
                category: ALT_ISSUE_CATEGORY[issue],
                tone: 'caution',
                timestamp: doc._updatedAt,
                changedAt: doc._updatedAt,
                intent: {
                  type: 'edit',
                  params: {
                    id: doc._id,
                    type: field.documentType,
                    path: `${field.fieldName}.${altFieldName}`,
                  },
                },
              }),
            )
          }
        }

        return {items: rows, altTargets: targets, assetsById: assets}
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `withAssignee` closes over `byTarget`/`assigneesById`, both already listed; it is redefined every render (not memoized) so including it would just make this dependency list re-describe itself.
      }, [
        oversized,
        unused,
        missingAlt,
        poorAlt,
        altEligibleFields,
        byTarget,
        assigneesById,
        languages,
        writeLanguage,
        languageField,
      ])

      // Where an asset row goes when no document uses it — a ladder, because a
      // media browser is a plugin, not something every Studio has. The
      // integrator's own router first, then a tool actually registered in
      // this workspace, then the file itself. Only a row with no `intent`
      // ever reaches this (`InboxRow`'s click order), so the used-asset rows
      // above can't collide with it.
      //
      // The middle rung can only ever land on the tool's own root, never the
      // specific asset: `sanity-plugin-media`'s asset modal is driven by its
      // own internal state, with no route or query param an outside caller
      // can address (checked its bundled source directly — no `router` field
      // on its tool definition, no `route.create()`, nothing reading a URL
      // param). So this also copies the asset's filename to the clipboard and
      // toasts what to do with it: paste it into the tool's own search, then
      // use *its* Replace — which is what actually fixes an oversized asset
      // for every document that references it. (A field-level fix, jumping to
      // one referencing document's image field, only swaps that one
      // document's reference and leaves the oversized file itself untouched
      // everywhere else it's used — wrong fix here, and moot for `unused`
      // rows anyway, which have no document to jump to. See `plans/060` for
      // why field-level navigation was already tried and removed once.)
      const openDetail = useCallback(
        (item: InboxItem) => {
          const asset = assetsById.get(item.id)
          if (!asset) return
          if (openAsset) {
            // Integrator's own callback owns this rung fully — no
            // clipboard, no toast layered on top of it.
            openAsset(asset)
            return
          }
          if (mediaToolName && navigateUrlRef.current) {
            navigateUrlRef.current({path: `${basePath}/${mediaToolName}`})

            const kind = assetRowKind(item.id) ?? 'oversized'
            const identifier = asset.filename || asset.id
            const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard

            if (!clipboard) {
              toast?.push({
                status: 'info',
                title: t(`assetIssues.copyFailed.${kind}`, {filename: identifier}),
              })
              return
            }

            clipboard.writeText(identifier).then(
              () => {
                const key = asset.filename ? 'filenameCopied' : 'idCopied'
                toast?.push({
                  status: 'success',
                  title: t(`assetIssues.${key}.title`, {filename: identifier}),
                  description: t(`assetIssues.${key}.${kind}`),
                })
                return undefined
              },
              () => {
                toast?.push({
                  status: 'info',
                  title: t(`assetIssues.copyFailed.${kind}`, {filename: identifier}),
                })
                return undefined
              },
            )
            return
          }
          // No deep link into the tool above, and none invented here: whether
          // a given media plugin accepts an asset id in its route is that
          // plugin's business, and a guessed route is a broken destination
          // dressed up as a working one. No clipboard/toast on this rung
          // either — there is no media-tool search box to point the copied
          // text at, so it would have nothing concrete to say.
          if (asset.url) window.open(asset.url, '_blank', 'noopener,noreferrer')
        },
        // `openAsset` is this source's own option, fixed for the source's lifetime, so it is deliberately not a dependency.
        [assetsById, mediaToolName, basePath, toast, t],
      )

      const proposeFix = useCallback(
        async (item: InboxItem, fixOptions?: {instantOnly?: boolean}): Promise<FixProposal | null> => {
          const target = altTargets.get(item.id)
          if (!target) return null

          // Re-read before proposing anything. The live query behind these
          // rows can be a few seconds stale, and the likeliest reason a row is
          // still on screen is that someone just filled this in by hand — same
          // guard, same reasoning as `proposeLinkFix` in
          // `linkCheckerFindings.ts`.
          const current = await client.fetch<unknown>(
            `*[_id == $id][0].${target.fieldName}.${altFieldName}`,
            {id: target.documentId},
          )
          // Any text at all, in any shape or language, means someone got
          // here first — and for a localized field it is also what stops a
          // plain string from ever being written over existing entries.
          if (toDisplayTitle(current, [])) return null

          const path = `${target.fieldName}.${altFieldName}`
          const write = (alt: string) => async () => {
            if (target.altShape === 'internationalizedArray' && target.language) {
              // Replacing the whole array is safe only because of the guard
              // above: every entry in it is empty. `_key` *and* `language`
              // carry the language, so both the plugin's older (`_key`) and
              // current (`language`) readers find it.
              await client
                .patch(target.documentId)
                .set({
                  [path]: [
                    {
                      _key: target.language,
                      _type: `${target.altTypeName}Value`,
                      language: target.language,
                      value: alt,
                    },
                  ],
                })
                .commit()
              return
            }
            if (target.altShape !== 'string') return
            await client
              .patch(target.documentId)
              .set({[path]: alt})
              .commit()
          }

          if (target.suggestion) {
            return {summary: `Set alt text to "${target.suggestion}"`, apply: write(target.suggestion)}
          }

          // Past this line costs the integrator money, so the bulk path —
          // which always passes `instantOnly` — stops here rather than
          // fanning one click out into one charge per selected row.
          if (fixOptions?.instantOnly || !describeImage || !target.imageUrl) return null

          const described = await describeImage({
            documentId: target.documentId,
            documentType: target.documentType,
            fieldName: target.fieldName,
            title: target.title,
            ...(target.language ? {language: target.language} : {}),
            // Capped width: the integrator pays for this call, and no vision
            // model needs the full-resolution original to write one sentence.
            imageUrl: `${target.imageUrl}?w=1024&fit=max&auto=format`,
          })

          const alt = described?.trim()
          // A model that rambles has misunderstood the job — alt text is one
          // sentence. Drop it rather than write an essay into the field.
          if (!alt || alt.length > MAX_ALT_LENGTH) return null
          return {summary: `Set alt text to "${alt}"`, apply: write(alt)}
        },
        [altTargets, client],
      )

      // Memoized rather than a fresh object literal per render: this result is
      // reported up to the pane and stored as state, so anything in it that
      // churns identity every render is a render every render (AGENTS.md).
      return useMemo(
        () => ({items, loading, error, assign, proposeFix, openDetail}),
        [items, loading, error, assign, proposeFix, openDetail],
      )
    },
  }
}
