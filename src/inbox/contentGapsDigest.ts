import {isDocumentSchemaType} from '@sanity/types'
import {type SanityClient} from 'sanity'

import {isHiddenType} from './AddMenu'

/** Per-type document count + counts, plus a small text sample cap — mirrors the `[0...20]` candidate cap `proposeFix` already uses elsewhere in this codebase. */
const SAMPLES_PER_TYPE = 5

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
  /** Up to `SAMPLES_PER_TYPE` short text values, most-recently-changed documents first — the only real-content signal this digest carries, since a field name alone never reveals what a project actually promotes. */
  samples: string[]
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
 * Returns `undefined` when the type has no such field (nothing sampleable).
 */
export function findSampleFieldName(
  schema: {get: (name: string) => {fields?: {name: string; type: {jsonType?: string}}[]} | undefined},
  typeName: string,
): string | undefined {
  const objectType = schema.get(typeName)
  if (!objectType?.fields) return undefined
  return objectType.fields.find((field) => field.type.jsonType === 'string')?.name
}

/**
 * One cheap `count()` plus a small text sample per real content type — the
 * whole-project survey `Inbox.tsx`'s "Find content gaps" read is built on.
 * Every fetch is capped (`SAMPLES_PER_TYPE` documents, `MAX_SURVEYED_TYPES`
 * types) — this is already the heaviest read in this pane; letting either
 * cap grow with dataset size would make it slower the more it has to say.
 */
export async function surveyContentTypes(
  client: Pick<SanityClient, 'fetch'>,
  schema: Parameters<typeof getRealDocumentTypeNames>[0] & Parameters<typeof findSampleFieldName>[0],
): Promise<ContentTypeSummary[]> {
  const types = getRealDocumentTypeNames(schema).slice(0, MAX_SURVEYED_TYPES)

  const summaries: ContentTypeSummary[] = []
  for (const {name, title} of types) {
    // eslint-disable-next-line no-await-in-loop -- one type at a time, deliberately: this is a developer-configured, manually-triggered read (never automatic), and a small sequential survey is simpler than a worker pool for a cap this low.
    const count = await client.fetch<number>('count(*[_type == $type])', {type: name})

    let samples: string[] = []
    const sampleField = count > 0 ? findSampleFieldName(schema, name) : undefined
    if (sampleField) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      const raw = await client.fetch<(string | null)[]>(
        `*[_type == $type] | order(_updatedAt desc)[0...$limit].${sampleField}`,
        {type: name, limit: SAMPLES_PER_TYPE},
      )
      samples = raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    }

    summaries.push({type: name, title, count, samples})
  }

  return summaries
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
      const samples = summary.samples.length > 0 ? `: ${summary.samples.join(' | ')}` : ''
      return `- ${summary.title} (${count})${samples}`
    })
    .join('\n')
}
