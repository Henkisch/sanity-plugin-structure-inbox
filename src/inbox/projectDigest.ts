import {isDocumentSchemaType} from '@sanity/types'
import {type SanityClient} from 'sanity'

import {isHiddenType} from './AddMenu'
import {mapWithConcurrency} from './concurrency'
import {SIMPLE_FIELD_PATH} from './sources/simpleFieldPath'

/** Per-type document count + counts, plus a small text sample cap — mirrors the `[0...20]` candidate cap `proposeFix` already uses elsewhere in this codebase. */
const SAMPLES_PER_TYPE = 5

/**
 * How far back `surveyContentTypes` looks before stride-sampling
 * `SAMPLES_PER_TYPE` values out of that window, instead of taking the
 * literal `SAMPLES_PER_TYPE` most-recently-updated documents. A type with
 * thousands of documents but only its last few days of edits touching one
 * campaign/topic would otherwise hand the AI read 5 samples that all look
 * alike — a wider window spread evenly gives a more representative slice
 * of what the type actually contains. Bounded the same way every other
 * cap in this file is: one extra query still runs per type either way, this
 * only changes that query's own `$limit` (bytes on the wire), not the
 * request count this digest is built to keep flat.
 */
const SAMPLE_WINDOW_SIZE = 100

/**
 * Total document types surveyed, capped the same way `openRows.slice(0, 30)`
 * caps Summarize's own digest — an explicit, named constant, not implicit
 * truncation. A project with more real content types than this only has its
 * first `MAX_SURVEYED_TYPES` (schema order) included in the read.
 */
export const MAX_SURVEYED_TYPES = 30

export interface ContentTypeSummary {
  type: string
  title: string
  count: number
  /** Up to `SAMPLES_PER_TYPE` short text values, stride-sampled across the most-recently-changed `SAMPLE_WINDOW_SIZE` documents — the only real-content signal this digest carries, since a field name alone never reveals what a project actually promotes. */
  samples: string[]
  /** This type's own schema `description`, when the integrator wrote one — real, already-authored editorial intent free for the reading. `undefined` when none exists. */
  description?: string
  /** Other real document types this one references, by title — reveals structure (e.g. "Post references Author, Category") with no extra dataset query, purely from the schema already in hand. */
  referencesTypes: string[]
}

/**
 * Every real project content type — same filter `AddMenu.tsx`'s own
 * "new content" menu already uses (`isHiddenType`, `isDocumentSchemaType`),
 * reused rather than redefined, so this digest surveys exactly the types an
 * editor could actually create from this pane.
 */
export function getRealDocumentTypeNames(schema: {
  getTypeNames: () => string[]
  get: (name: string) => {name: string; title?: string} | undefined
}): {name: string; title: string}[] {
  return schema
    .getTypeNames()
    .filter((name) => !isHiddenType(name))
    .map((name) => schema.get(name))
    .filter((type) => type !== undefined && isDocumentSchemaType(type))
    .map((type) => ({name: type.name, title: type.title || type.name}))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * The first field on `typeName` that could plausibly hold a human-readable
 * blurb — same `jsonType === 'string'` eligibility check
 * `singleTextFieldEligible` (`linkCheckerFindings.ts`) already uses for the
 * same reason: a schema-agnostic "is this field text" test, not a guess at
 * a specific field name like `title`/`body`, which not every project uses.
 * Returns `undefined` when the type has no such field (nothing sampleable),
 * and also when the field's own name fails `SIMPLE_FIELD_PATH` — this name
 * comes from the integrator's own schema, and one odd field name should cost
 * that type its samples, not get spliced into the query text `surveyContentTypes`
 * builds from it below. Skip rather than throw: `surveyContentTypes` already
 * treats `undefined` as "no samples for this type."
 */
export function findSampleFieldName(
  schema: {get: (name: string) => {fields?: {name: string; type: {jsonType?: string}}[]} | undefined},
  typeName: string,
): string | undefined {
  const objectType = schema.get(typeName)
  if (!objectType?.fields) return undefined
  const fieldName = objectType.fields.find((field) => field.type.jsonType === 'string')?.name
  if (fieldName === undefined || !SIMPLE_FIELD_PATH.test(fieldName)) return undefined
  return fieldName
}

/**
 * Every other real document type `typeName`'s own fields reference,
 * deduplicated, by title — same `fieldType.to` shape
 * `linkCheckerFindings.ts`'s `singleReferenceTargetType` already reads
 * for one field; this walks every field on the type instead of one named
 * field, and every target `to` entry rather than requiring exactly one.
 * Top-level fields only, same "v1" limit `findAltEligibleImageFields`
 * (`assetIssues.ts`) already documents for its own schema walk — a
 * reference nested inside an object or array isn't walked here either.
 */
export function findReferencedTypes(
  schema: {get: (name: string) => {fields?: {type: {to?: {name: string}[]}}[]} | undefined},
  realTypesByName: Map<string, string>,
  typeName: string,
): string[] {
  const objectType = schema.get(typeName)
  if (!objectType?.fields) return []

  const titles = new Set<string>()
  for (const field of objectType.fields) {
    for (const target of field.type.to ?? []) {
      const title = realTypesByName.get(target.name)
      if (title) titles.add(title)
    }
  }
  return [...titles]
}

/**
 * Picks `sampleSize` items evenly spread across `items`, in order, rather
 * than just the first `sampleSize` — e.g. `strideSample([a,b,c,d,e,f,g,h,i,j], 5)`
 * returns `[a,c,e,g,i]`ish (index `Math.floor(i * items.length / sampleSize)`),
 * not `[a,b,c,d,e]`. Returns `items` unchanged (in one array, not sliced by
 * reference) when there are already `sampleSize` or fewer.
 */
export function strideSample<T>(items: readonly T[], sampleSize: number): T[] {
  if (items.length <= sampleSize) return [...items]
  return Array.from({length: sampleSize}, (_, i) => items[Math.floor((i * items.length) / sampleSize)])
}

/** Parallel fetches in flight at once — enough to cut wall-clock time meaningfully on a project with many real content types, low enough to stay well clear of a burst against Sanity's own API rate limits. */
const SURVEY_CONCURRENCY = 5

/**
 * One cheap `count()` plus a small, stride-sampled text sample per real
 * content type — the whole-project survey `Inbox.tsx`'s "Find content gaps"
 * and "Ask" reads are built on. Every fetch is capped (`SAMPLE_WINDOW_SIZE`
 * documents fetched, `SAMPLES_PER_TYPE` of those actually kept,
 * `MAX_SURVEYED_TYPES` types) — this is already the heaviest read in this
 * pane; letting any of these caps grow with dataset size would make it
 * slower the more it has to say. The per-type fetches themselves run with
 * bounded concurrency (`SURVEY_CONCURRENCY`), not fully sequentially and not
 * all at once — see this plan's own "At scale" note for why a fully
 * sequential loop stopped being fine once `MAX_SURVEYED_TYPES` is actually
 * hit.
 */
export async function surveyContentTypes(
  client: Pick<SanityClient, 'fetch'>,
  schema: Parameters<typeof getRealDocumentTypeNames>[0] &
    Parameters<typeof findSampleFieldName>[0] &
    Parameters<typeof findReferencedTypes>[0],
): Promise<ContentTypeSummary[]> {
  const types = getRealDocumentTypeNames(schema).slice(0, MAX_SURVEYED_TYPES)
  const realTypesByName = new Map(types.map(({name, title}) => [name, title]))

  return mapWithConcurrency(types, SURVEY_CONCURRENCY, async ({name, title}) => {
    const count = await client.fetch<number>('count(*[_type == $type])', {type: name})

    let samples: string[] = []
    const sampleField = count > 0 ? findSampleFieldName(schema, name) : undefined
    if (sampleField) {
      const windowLimit = Math.min(count, SAMPLE_WINDOW_SIZE)
      const raw = await client.fetch<(string | null)[]>(
        `*[_type == $type] | order(_updatedAt desc)[0...$limit].${sampleField}`,
        {type: name, limit: windowLimit},
      )
      const nonEmpty = raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      samples = strideSample(nonEmpty, SAMPLES_PER_TYPE)
    }

    const objectType = schema.get(name)
    const rawDescription = objectType && 'description' in objectType ? objectType.description : undefined
    const description = typeof rawDescription === 'string' ? rawDescription : undefined
    const referencesTypes = findReferencedTypes(schema, realTypesByName, name)

    return {type: name, title, count, samples, description, referencesTypes}
  })
}

/**
 * The survey, rendered as plain text for the AI prompt — one line per type
 * that actually has documents (an empty type still says "0 documents",
 * itself sometimes the whole gap), samples inlined so the read has some
 * real content to reason about, not just a shape.
 */
export function formatContentGapsDigest(summaries: readonly ContentTypeSummary[]): string {
  return summaries
    .map((summary) => {
      const count = `${summary.count} document${summary.count === 1 ? '' : 's'}`
      const description = summary.description ? ` — ${summary.description}` : ''
      const references =
        summary.referencesTypes.length > 0 ? ` (references: ${summary.referencesTypes.join(', ')})` : ''
      const samples = summary.samples.length > 0 ? `: ${summary.samples.join(' | ')}` : ''
      return `- ${summary.title} (${count})${description}${references}${samples}`
    })
    .join('\n')
}
