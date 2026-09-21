import {ImageIcon} from '@sanity/icons/Image'
import {isDocumentSchemaType, isImageSchemaType} from '@sanity/types'
import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {useClient, useCurrentUser, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {isHiddenType} from '../AddMenu'
import {
  type FixProposal,
  type InboxItem,
  type InboxSource,
  type InboxSourceResult,
} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {useAssignableUsers} from './capability'
import {liveQuery$} from './liveQuery'

/** Real image/file asset documents this project's own dataset holds. */
const ASSET_TYPES = ['sanity.imageAsset', 'sanity.fileAsset']

/** A plain field name — no `[index]`/`.nested`/`->` — the only shape safe to interpolate directly into a GROQ query string. Same guard `linkCheckerFindings.ts` uses for the equivalent interpolation. */
const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/

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

/** True when some sub-field is named `altFieldName` — works the same whether `fields` came from a direct image type or a wrapper object type. */
function hasAltSibling(
  fields: {name: string; type: WalkableSchemaType}[] | undefined,
  altFieldName: string,
): boolean {
  return Boolean(fields?.some((sub) => sub.name === altFieldName))
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
      if (!hasAltSibling(fieldType.fields, altFieldName)) continue
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
  /** The document's own title/name/label — absent when it has none. */
  title?: string
}

export interface AssetIssuesOptions {
  /** Cap on rows per check (oversized, unused, missing alt text — each capped independently). Defaults to 20. */
  limit?: number
  /** Row category label. Defaults to a translated "Asset issues"; a custom value is shown exactly as given. */
  title?: string
  /** An asset over this size counts as oversized. Defaults to 5 MiB. */
  maxSizeBytes?: number
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
 * `normalizeForComparison` beside it.
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
  originalFilename?: string
  size: number
}

const OVERSIZED_QUERY = `*[_type in $assetTypes && size > $maxSizeBytes] | order(size desc)[0...$limit]{_id, originalFilename, size}`
const UNUSED_QUERY = `*[_type in $assetTypes && count(*[references(^._id)]) == 0] | order(size desc)[0...$limit]{_id, originalFilename, size}`
const ASSET_COUNT_QUERY = `count(*[_type in $assetTypes])`

interface MissingAltRow {
  _id: string
  title: string
  /**
   * The document's own title/name/label, *without* the `_id` fallback
   * `title` carries. `title` is display text and is always a string; this is
   * the only one a fix is allowed to write, because `alt="person-a1b2c3"` is
   * worse than no alt text at all.
   */
  safeTitle?: string
  /** The image asset's CDN url, for `describeImage`. Absent when the field holds no asset. */
  imageUrl?: string
  _updatedAt?: string
}

interface PoorAltRow {
  _id: string
  title: string
  _updatedAt?: string
  alt: string
  assetFilename?: string
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
  /** Non-null exactly when a deterministic answer exists — this is what makes a row quick-fixable. */
  suggestion: string | null
}

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
 * Oversized/unused rows have no `intent`: `sanity.imageAsset`/
 * `sanity.fileAsset` are real document types but are deliberately excluded
 * from Structure Tool's own default document-type handling (confirmed by
 * reading that package's own source — see this plan's own Step 1 findings),
 * so there is no safe "open" target for one outside the Media browser.
 * Missing- and poor-alt-text rows are on a real, ordinary document, so
 * those do get the normal `'edit'` intent.
 */
export function assetIssues(options: AssetIssuesOptions = {}): InboxSource {
  const {
    limit = 20,
    title = 'source.assetIssues.defaultTitle',
    maxSizeBytes = 5 * 1024 * 1024,
    altFieldName = 'alt',
    altFromTitle,
    suggestAlt,
    describeImage,
  } = options

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
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      // "Who's fixing this" — a task like any other, delegable even though
      // an asset (unlike a draft) can be referenced by zero or many
      // documents, so there's no single natural owner to fall back to.
      // Same shared record every assignable source writes through.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
      const assignments = useAssignmentStore(client, ASSIGNMENT_TYPE)

      const assigneesById = useMemo(() => {
        const byId = new Map<string, {id: string; label: string; imageUrl?: string}>()
        for (const user of assignable ?? []) {
          const isSelf = user.id === userId
          byId.set(user.id, {
            id: user.id,
            label: user.displayName || user.email || user.id,
            imageUrl: (isSelf && currentUser?.profileImage) || user.imageUrl,
          })
        }
        return byId
      }, [assignable, userId, currentUser])

      const altEligibleFields = useMemo(() => findAltEligibleImageFields(schema, altFieldName), [schema])

      const fetch$ = useMemo(() => {
        const params = {assetTypes: ASSET_TYPES, maxSizeBytes, limit}

        const read$ = defer(() =>
          from(
            (async () => {
              const [oversized, assetCount, missingAlt, poorAlt] = await Promise.all([
                client.fetch<AssetRow[]>(OVERSIZED_QUERY, params),
                client.fetch<number>(ASSET_COUNT_QUERY, params),
                Promise.all(
                  altEligibleFields.map((field) =>
                    client.fetch<MissingAltRow[]>(
                      `*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), "safeTitle": coalesce(title, name, label), "imageUrl": ${field.imagePath}.asset->url, _updatedAt}`,
                      {type: field.documentType, limit},
                    ),
                  ),
                ),
                Promise.all(
                  altEligibleFields.map((field) =>
                    client.fetch<PoorAltRow[]>(
                      `*[_type == $type && defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt, "alt": ${field.fieldName}.${altFieldName}, "assetFilename": ${field.imagePath}.asset->originalFilename}`,
                      {type: field.documentType, limit},
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
        )

        // Any change to an asset or an eligible document type could add,
        // remove, or fix a finding — refetch everything rather than try to
        // patch one check's own result in place.
        const listenTypes = [...ASSET_TYPES, ...altEligibleFields.map((f) => f.documentType)]
        return liveQuery$(client, `_type in $types`, {types: listenTypes}, read$).pipe(
          map((result): AssetIssuesFetch => ({...result, loading: false})),
          startWith<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], poorAlt: [], loading: true}),
          catchError((error: Error) =>
            of<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], poorAlt: [], error}),
          ),
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `altEligibleFields` is a derived, memoized array (schema is stable for this pane's lifetime); re-running this on every render it appears in would defeat the memoization the schema walk is already doing.
      }, [client, maxSizeBytes, limit])

      const {oversized, unused, missingAlt, poorAlt, loading, error} = useObservable(fetch$, {
        oversized: [] as AssetRow[],
        unused: [] as AssetRow[],
        missingAlt: [] as MissingAltRow[][],
        poorAlt: [] as PoorAltRow[][],
        loading: true,
      })

      const withAssignee = (row: InboxItem): InboxItem => {
        const assignedTo = assignments.byTarget.get(row.id)
        const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
        return assignee ? {...row, assignee} : row
      }

      // `items` and the fix's own lookup table are built in one pass, and
      // deliberately share a `useMemo`: they are two views of the same rows,
      // and computing them apart is how they drift — a row advertising
      // `quickFixable` that `proposeFix` then can't find anything for.
      const {items, altTargets} = useMemo(() => {
        const rows: InboxItem[] = []
        const targets = new Map<string, AltTarget>()

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

        for (const asset of unused) {
          rows.push(
            withAssignee({
              id: `unused:${asset._id}`,
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
          for (const doc of fieldMissingAlt) {
            const id = `missingAlt:${doc._id}:${field.fieldName}`
            const ctx = {
              documentId: doc._id,
              documentType: field.documentType,
              fieldName: field.fieldName,
              title: doc.safeTitle,
            }
            const suggestion = suggestAltText(ctx, {altFromTitle, suggestAlt})

            targets.set(id, {...ctx, imageUrl: doc.imageUrl, suggestion})

            rows.push(
              withAssignee({
                id,
                title: doc.title,
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
                fixable: suggestion !== null || Boolean(describeImage && doc.imageUrl),
              }),
            )
          }
        }

        for (const [index, fieldPoorAlt] of poorAlt.entries()) {
          const field = altEligibleFields[index]
          if (!field) continue
          for (const doc of fieldPoorAlt) {
            const issue = classifyAltText(doc.alt, doc.assetFilename)
            if (!issue) continue
            rows.push(
              withAssignee({
                id: `poorAlt:${doc._id}:${field.fieldName}`,
                title: doc.title,
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

        return {items: rows, altTargets: targets}
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `withAssignee` closes over `assignments.byTarget`/`assigneesById`, both already listed; it is redefined every render (not memoized) so including it would just make this dependency list re-describe itself.
      }, [
        oversized,
        unused,
        missingAlt,
        poorAlt,
        altEligibleFields,
        assignments.byTarget,
        assigneesById,
      ])

      const assign = useMemo(() => {
        if (!assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            await assignments.assign(item.id, assignedTo)
          },
          unassign: async (item: InboxItem) => {
            await assignments.unassign(item.id)
          },
        }
      }, [assignable, assignments])

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
          if (typeof current === 'string' && current.trim()) return null

          const write = (alt: string) => async () => {
            await client
              .patch(target.documentId)
              .set({[`${target.fieldName}.${altFieldName}`]: alt})
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
        () => ({items, loading, error, assign, proposeFix}),
        [items, loading, error, assign, proposeFix],
      )
    },
  }
}
