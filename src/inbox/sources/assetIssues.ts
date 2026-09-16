import {ImageIcon} from '@sanity/icons/Image'
import {isDocumentSchemaType, isImageSchemaType} from '@sanity/types'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {useClient, useCurrentUser, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {isHiddenType} from '../AddMenu'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
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

/** True when some sub-field's own type is an image type — the wrapper-object convention's inner field, name-agnostic. */
function hasImageSubfield(fields: {name: string; type: WalkableSchemaType}[] | undefined): boolean {
  return Boolean(fields?.some((sub) => isImageSchemaType(sub.type)))
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
      const isWrapperWithImage = !isDirectImage && hasImageSubfield(fieldType.fields)
      if (!isDirectImage && !isWrapperWithImage) continue
      if (!hasAltSibling(fieldType.fields, altFieldName)) continue
      // Guards the GROQ interpolation below (`assetIssues`'s missing-/poor-alt
      // queries splice `field.fieldName` straight into the query string) —
      // a real Sanity field name is already restricted to a safe identifier
      // shape at schema-definition time, so this is a defensive skip, not a
      // check expected to ever actually reject a genuine schema field.
      if (!SIMPLE_FIELD_PATH.test(field.name)) continue

      results.push({
        documentType: typeName,
        documentTypeTitle: type.title || typeName,
        fieldName: field.name,
        fieldTitle: fieldType.title || field.name,
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

export interface AssetIssuesOptions {
  /** Cap on rows per check (oversized, unused, missing alt text — each capped independently). Defaults to 20. */
  limit?: number
  title?: string
  /** An asset over this size counts as oversized. Defaults to 5 MiB. */
  maxSizeBytes?: number
  /** The sub-field name on an image field that holds its alt text. Defaults to `'alt'`. */
  altFieldName?: string
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
 * aggregate. No AI, no `resolve`: fixing any of these means editing the
 * asset or the document that references it, the same reasoning
 * `documentValidation` already uses for a schema validation error —
 * acknowledge-only.
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
  const {limit = 20, title = 'Asset issues', maxSizeBytes = 5 * 1024 * 1024, altFieldName = 'alt'} = options

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
                      `*[_type == $type && defined(${field.fieldName}) && !defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt}`,
                      {type: field.documentType, limit},
                    ),
                  ),
                ),
                Promise.all(
                  altEligibleFields.map((field) =>
                    client.fetch<PoorAltRow[]>(
                      `*[_type == $type && defined(${field.fieldName}.${altFieldName})] | order(_updatedAt desc)[0...$limit]{_id, "title": coalesce(title, name, label, _id), _updatedAt, "alt": ${field.fieldName}.${altFieldName}, "assetFilename": ${field.fieldName}.asset->originalFilename}`,
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

      const items = useMemo(() => {
        const rows: InboxItem[] = []

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
            rows.push(
              withAssignee({
                id: `missingAlt:${doc._id}:${field.fieldName}`,
                title: doc.title,
                subtitle: `${field.documentTypeTitle} · ${field.fieldTitle}`,
                category: 'Missing alt text',
                tone: 'caution',
                timestamp: doc._updatedAt,
                changedAt: doc._updatedAt,
                intent: {type: 'edit', params: {id: doc._id, type: field.documentType}},
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
                intent: {type: 'edit', params: {id: doc._id, type: field.documentType}},
              }),
            )
          }
        }

        return rows
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `withAssignee` closes over `assignments.byTarget`/`assigneesById`, both already listed; it is redefined every render (not memoized) so including it would just make this dependency list re-describe itself.
      }, [oversized, unused, missingAlt, poorAlt, altEligibleFields, assignments.byTarget, assigneesById])

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

      return {items, loading, error, assign}
    },
  }
}
