import type {SanityClient} from '@sanity/client'
import {ErrorOutlineIcon} from '@sanity/icons/ErrorOutline'
// Deliberately a namespace import — see `optionalExport` in `capability.ts`.
// `validateDocument` is `@beta` in `@sanity/validation`, and that package is
// not `sanity` itself, so `optionalHook` (hardcoded to the `sanity`
// namespace) cannot reach it.
import * as sanityValidation from '@sanity/validation'
import {useEffect, useMemo, useState} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {
  useClient,
  useCurrentUser,
  useSchema,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {API_VERSION} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {optionalExport, optionalHook} from './capability'
import {liveQuery$} from './liveQuery'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

/**
 * `validateDocument`'s own real shape, confirmed live against this repo's
 * test dataset before writing this source — see this plan's own
 * `## Findings — Phase A, Step 1`. `@beta`, reached only through
 * `optionalExport`, never a static import.
 */
interface ValidateDocumentMarker {
  level: 'error' | 'warning' | 'info'
  message: string
  path: unknown[]
}

interface ValidateDocumentResult {
  status: 'passed' | 'failed' | 'notEvaluated'
  markers: ValidateDocumentMarker[]
}

type ValidateDocumentFn = (options: {
  document: Record<string, unknown>
  schema: unknown
  client: SanityClient
  currentUser?: unknown
  getDocumentExists?: (options: {id: string}) => Promise<boolean>
}) => Promise<ValidateDocumentResult>

/** Degrades to "nothing evaluated" when `@sanity/validation` is unavailable — never throws. */
const unavailableValidateDocument: ValidateDocumentFn = () =>
  Promise.resolve({status: 'notEvaluated', markers: []})

const validateDocument = optionalExport<ValidateDocumentFn>(
  sanityValidation,
  'validateDocument',
  unavailableValidateDocument,
)

/**
 * A field name a plain object might carry — `_ref` on a `reference` or an
 * `image`/`file`'s own `asset` value. Walked structurally, not by schema:
 * finding every reference in a document this way needs no knowledge of
 * which fields are references, only of the shape a reference already has.
 */
export function collectReferenceIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceIds(item, into)
    return
  }
  if (typeof value !== 'object' || value === null) return

  // eslint-disable-next-line no-unsafe-type-assertion -- narrowed to a plain object above (not an array, not null); every own key is read defensively below regardless of its actual value.
  const record = value as Record<string, unknown>
  if (typeof record._ref === 'string') into.add(record._ref)
  for (const key of Object.keys(record)) {
    if (key === '_ref') continue
    collectReferenceIds(record[key], into)
  }
}

/** A `PathSegment[]` rendered as a dotted field path — good enough for a row's own subtitle, not a real patch path. */
export function formatValidationPath(path: unknown[]): string {
  return path
    .map((segment) => {
      if (typeof segment === 'string' || typeof segment === 'number') return String(segment)
      if (segment && typeof segment === 'object' && '_key' in segment) {
        return `[${String(segment._key)}]`
      }
      return '[?]'
    })
    .join('.')
}

/** One row's own subtitle: every `'error'`-level marker on a document, joined. Exported for its own test. */
export function summarizeErrors(result: ValidateDocumentResult): string | null {
  const errors = result.markers.filter((marker) => marker.level === 'error')
  if (errors.length === 0) return null
  return errors
    .map((marker) => `${formatValidationPath(marker.path) || '(document)'}: ${marker.message}`)
    .join(' · ')
}

/**
 * The plain metadata fields a row needs off a raw draft document — narrowed
 * with `typeof` guards rather than a cast, since a draft's own shape is
 * whatever its schema allows, not something this source controls.
 */
function draftMeta(draft: Record<string, unknown>): {
  id: string
  type: string
  title: string
  updatedAt?: string
} {
  const id = String(draft._id)
  const type = typeof draft._type === 'string' ? draft._type : 'unknown'
  const title = typeof draft.title === 'string' && draft.title ? draft.title : type || id
  const updatedAt = typeof draft._updatedAt === 'string' ? draft._updatedAt : undefined
  return {id, type, title, updatedAt}
}

const TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
        return undefined
      },
      () => {
        clearTimeout(timer)
        resolve(onTimeout)
        return undefined
      },
    )
  })
}

/**
 * Runs `mapper` over `items` with at most `concurrency` in flight at once —
 * a bad custom validator on one document (an arbitrary async `rule.custom`)
 * should slow this down, never let an unbounded `Promise.all` pile up every
 * document's own validation at once. Exported for its own test.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({length: items.length})
  let next = 0

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      // eslint-disable-next-line no-await-in-loop -- the whole point of a worker: process its own share one at a time, sequentially; concurrency comes from running `concurrency` workers in parallel, not from overlapping awaits within one.
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker))
  return results
}

export interface DocumentValidationOptions {
  /** Candidate drafts fetched, not rows necessarily shown. Defaults to 20. */
  limit?: number
  title?: string
  /** Restrict to these document types. Defaults to every type in the schema. */
  types?: string[]
}

const QUERY = `*[
  _id in path("drafts.**") &&
  ($types == null || _type in $types)
] | order(_updatedAt desc)[0...$limit]`

interface DraftsFetch {
  drafts: Record<string, unknown>[]
  loading?: boolean
  error?: Error
}

/**
 * Runs `validateDocument` over `drafts` whenever the batch changes,
 * bounded-concurrency and per-document timeout, into a
 * `Map<draftId, ValidateDocumentResult>`. A validation run superseded by a
 * newer `drafts` batch (the previous effect's own cleanup sets `cancelled`)
 * simply never applies its result — there is nothing partial to unwind, the
 * same "let it finish, ignore it" posture already used elsewhere in this
 * codebase for a stale in-flight suggestion.
 */
function useValidationResults(
  client: SanityClient,
  schema: ReturnType<typeof useSchema>,
  currentUser: ReturnType<typeof useCurrentUser>,
  drafts: Record<string, unknown>[],
): Map<string, ValidateDocumentResult> {
  const [results, setResults] = useState<Map<string, ValidateDocumentResult>>(new Map())

  useEffect(() => {
    if (drafts.length === 0) {
      setResults(new Map())
      return undefined
    }

    let cancelled = false

    const referenceIds = new Set<string>()
    for (const draft of drafts) collectReferenceIds(draft, referenceIds)

    async function run(): Promise<void> {
      const existingIds =
        referenceIds.size > 0
          ? new Set(
              await client.fetch<string[]>('*[_id in $ids]._id', {
                ids: Array.from(referenceIds),
              }),
            )
          : new Set<string>()

      const validated = await mapWithConcurrency(drafts, 5, async (draft) => {
        const result = await withTimeout(
          validateDocument({
            document: draft,
            schema,
            client,
            currentUser: currentUser ?? undefined,
            getDocumentExists: ({id}) => Promise.resolve(existingIds.has(id)),
          }),
          TIMEOUT_MS,
          {status: 'notEvaluated' as const, markers: []},
        )
        return [String(draft._id), result] as const
      })

      if (!cancelled) setResults(new Map(validated))
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `client`/`schema`/`currentUser` are stable for this pane's lifetime; only a real change in `drafts` should re-run validation.
  }, [drafts])

  return results
}

/**
 * Drafts currently failing their own schema's `validation` rules —
 * something every Sanity Studio defines, and nothing in Sanity's own
 * Structure Tool or this plugin surfaced in aggregate before this source.
 *
 * Deliberately drafts only, v1: a draft is "someone is actively working on
 * this right now," the same scope `unpublishedDrafts` already uses.
 * Published documents can fail validation too — extending to them is a
 * later option, not this source's job today.
 *
 * Runs `validateDocument` from `@sanity/validation` — the same engine
 * Sanity's own `sanity documents validate` CLI command calls in bulk, with
 * no per-document form/DOM mounting (confirmed by reading that command's
 * own worker before building this). `@beta`, reached only through
 * `optionalExport`, degrading to "nothing evaluated" rather than throwing
 * if it's ever renamed or removed.
 *
 * Reference existence is checked with one batched query up front
 * (`getDocumentExists` reads a plain `Set`) rather than letting
 * `validateDocument` call the `doc` endpoint once per reference per
 * document — the same reasoning Sanity's own CLI worker gives for
 * pre-batching this.
 *
 * No `resolve`: a validation error is fixed by editing the document, the
 * same reasoning `needsAttention` already uses for an off-track release —
 * a tick here only acknowledges. No AI: a schema's own rules are already
 * fully deterministic.
 */
export function documentValidation(options: DocumentValidationOptions = {}): InboxSource {
  const {limit = 20, title = 'Needs fixing', types} = options

  return {
    name: 'documentValidation',
    title,
    icon: ErrorOutlineIcon,
    placement: 'main',
    // A draft's own validation state is the team's problem, not one
    // editor's — same reasoning `unpublishedDrafts` uses by default.
    audience: 'everyone',

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      // `null` documentValue, same reasoning `unpublishedDrafts.ts` gives:
      // not scoped to one draft, since any of them could be assigned.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
      // Same shared assignment record `unpublishedDrafts.ts` writes through
      // — these rows are the identical draft documents, just filtered to
      // ones currently failing validation, so "who's on this draft" has to
      // be the same fact regardless of which view surfaces it.
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

      const fetch$ = useMemo(() => {
        const params = {limit, types: types ?? null}
        const readDrafts$ = defer(() => from(client.fetch<Record<string, unknown>[]>(QUERY, params)))

        return liveQuery$(client, '*[_id in path("drafts.**")]', {}, readDrafts$).pipe(
          map((drafts): DraftsFetch => ({drafts})),
          startWith<DraftsFetch>({drafts: [], loading: true}),
          catchError((error: Error) => of<DraftsFetch>({drafts: [], error})),
        )
      }, [client])

      const {drafts, loading, error} = useObservable(fetch$, {drafts: [], loading: true})
      const results = useValidationResults(client, schema, currentUser, drafts)

      const items = useMemo(() => {
        const rows: InboxItem[] = []
        for (const draft of drafts) {
          const meta = draftMeta(draft)
          const result = results.get(meta.id)
          if (!result || result.status !== 'failed') continue

          const subtitle = summarizeErrors(result)
          if (!subtitle) continue

          const canonicalId = meta.id.replace(/^drafts\./, '')
          const assignedTo = assignments.byTarget.get(canonicalId)
          const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined

          const row: InboxItem = {
            id: meta.id,
            title: meta.title,
            subtitle,
            timestamp: meta.updatedAt,
            changedAt: meta.updatedAt,
            tone: 'critical',
            intent: {
              type: 'edit',
              params: {id: canonicalId, type: meta.type},
            },
          }
          rows.push(assignee ? {...row, assignee} : row)
        }
        return rows
      }, [drafts, results, assignments.byTarget, assigneesById])

      const assign = useMemo(() => {
        if (!assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            const targetId = item.intent?.params.id
            if (targetId) await assignments.assign(targetId, assignedTo)
          },
          unassign: async (item: InboxItem) => {
            const targetId = item.intent?.params.id
            if (targetId) await assignments.unassign(targetId)
          },
        }
      }, [assignable, assignments])

      return {items, loading, error, assign}
    },
  }
}
