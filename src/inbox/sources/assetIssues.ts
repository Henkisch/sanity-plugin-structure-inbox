import {ImageIcon} from '@sanity/icons/Image'
import {isDocumentSchemaType, isImageSchemaType} from '@sanity/types'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
import {useClient, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {isHiddenType} from '../AddMenu'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {liveQuery$} from './liveQuery'

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
 * per document type rather than queried off the asset. Top-level fields
 * only, v1 — an image nested inside an object or array isn't walked.
 * Exported for its own test.
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

interface AssetIssuesFetch {
  oversized: AssetRow[]
  unused: AssetRow[]
  missingAlt: MissingAltRow[][]
  loading?: boolean
  error?: Error
}

/**
 * Unused, oversized, and missing-alt-text image/file assets — none of
 * which Sanity's own Structure Tool or Media library surfaces in
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
 * Missing-alt-text rows are on a real, ordinary document, so those do get
 * the normal `'edit'` intent.
 */
export function assetIssues(options: AssetIssuesOptions = {}): InboxSource {
  const {limit = 20, title = 'Asset issues', maxSizeBytes = 5 * 1024 * 1024, altFieldName = 'alt'} = options

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

      const altEligibleFields = useMemo(() => findAltEligibleImageFields(schema, altFieldName), [schema])

      const fetch$ = useMemo(() => {
        const params = {assetTypes: ASSET_TYPES, maxSizeBytes, limit}

        const read$ = defer(() =>
          from(
            (async () => {
              const [oversized, assetCount, missingAlt] = await Promise.all([
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
              ])

              const unused =
                assetCount <= UNUSED_ASSET_SCAN_LIMIT
                  ? await client.fetch<AssetRow[]>(UNUSED_QUERY, params)
                  : []

              return {oversized, unused, missingAlt}
            })(),
          ),
        )

        // Any change to an asset or an eligible document type could add,
        // remove, or fix a finding — refetch everything rather than try to
        // patch one check's own result in place.
        const listenTypes = [...ASSET_TYPES, ...altEligibleFields.map((f) => f.documentType)]
        return liveQuery$(client, `_type in $types`, {types: listenTypes}, read$).pipe(
          map((result): AssetIssuesFetch => ({...result, loading: false})),
          startWith<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], loading: true}),
          catchError((error: Error) =>
            of<AssetIssuesFetch>({oversized: [], unused: [], missingAlt: [], error}),
          ),
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `altEligibleFields` is a derived, memoized array (schema is stable for this pane's lifetime); re-running this on every render it appears in would defeat the memoization the schema walk is already doing.
      }, [client, maxSizeBytes, limit])

      const {oversized, unused, missingAlt, loading, error} = useObservable(fetch$, {
        oversized: [] as AssetRow[],
        unused: [] as AssetRow[],
        missingAlt: [] as MissingAltRow[][],
        loading: true,
      })

      const items = useMemo(() => {
        const rows: InboxItem[] = []

        for (const asset of oversized) {
          rows.push({
            id: `oversized:${asset._id}`,
            title: asset.originalFilename || asset._id,
            subtitle: formatAssetSize(asset.size),
            category: 'Oversized asset',
            tone: 'caution',
          })
        }

        for (const asset of unused) {
          rows.push({
            id: `unused:${asset._id}`,
            title: asset.originalFilename || asset._id,
            subtitle: formatAssetSize(asset.size),
            category: 'Unused asset',
            tone: 'caution',
          })
        }

        for (const [index, fieldMissingAlt] of missingAlt.entries()) {
          const field = altEligibleFields[index]
          if (!field) continue
          for (const doc of fieldMissingAlt) {
            rows.push({
              id: `missingAlt:${doc._id}:${field.fieldName}`,
              title: doc.title,
              subtitle: `${field.documentTypeTitle} · ${field.fieldTitle}`,
              category: 'Missing alt text',
              tone: 'caution',
              timestamp: doc._updatedAt,
              changedAt: doc._updatedAt,
              intent: {type: 'edit', params: {id: doc._id, type: field.documentType}},
            })
          }
        }

        return rows
      }, [oversized, unused, missingAlt, altEligibleFields])

      return {items, loading, error}
    },
  }
}
