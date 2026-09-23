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
import {useClient, useCurrentUser, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {toDisplayTitle} from '../../i18n/contentText'
import {
  documentLanguage,
  useContentLanguages,
  useDocumentLanguageField,
} from '../../i18n/useContentLanguages'
import {warnOnce} from '../../warnOnce'
import {mapWithConcurrency} from '../concurrency'
import {getRealDocumentTypeNames} from '../projectDigest'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {targetIdFromIntentParamsId, useAssignmentCapability} from './assignmentCapability'
import {optionalExport} from './capability'
import {liveQuery$} from './liveQuery'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function titleOf(type: unknown): string | undefined {
  const title = asRecord(type)?.title
  return typeof title === 'string' && title ? title : undefined
}

/**
 * A validation path in the words the editor sees in the form — field titles,
 * and the title of each array item's own block type, joined with `›` —
 * instead of `pageBuilder.[59ef9b1141c5].buttons.[0176b0ddf1ab].url.internal`,
 * which no editor can read (reported from a real Studio).
 *
 * Walks the schema alongside the draft itself, because a keyed array
 * segment only says *which* item, not what type it is; the item's own
 * `_type` does. Any step it can't resolve falls back to the raw field name
 * for that step and carries on, so the worst case is today's text minus the
 * keys, never an empty string.
 *
 * @internal
 */
export function describeValidationPath(
  schema: {get: (name: string) => unknown},
  documentType: string,
  document: unknown,
  path: unknown[],
): string {
  let type: unknown = schema.get(documentType)
  let value: unknown = document
  const parts: string[] = []

  for (const segment of path) {
    if (typeof segment === 'string') {
      const fields = asRecord(type)?.fields
      const field = Array.isArray(fields)
        ? fields.map(asRecord).find((candidate) => candidate?.name === segment)
        : undefined
      parts.push(titleOf(field?.type) ?? titleOf(field) ?? segment)
      type = field?.type
      value = asRecord(value)?.[segment]
      continue
    }

    // An array step, by `_key` or by index: find the item, then its member
    // type by the item's own `_type`.
    const items = Array.isArray(value) ? value : []
    const key = asRecord(segment)?._key
    const item =
      typeof segment === 'number'
        ? items[segment]
        : items.find((candidate) => asRecord(candidate)?._key === key)
    const itemType = asRecord(item)?._type
    const members = asRecord(type)?.of
    const member = Array.isArray(members)
      ? members.map(asRecord).find((candidate) => candidate?.name === itemType)
      : undefined
    // Name the item only when it's a block of its own (a "Hero", a "Button
    // group"), not a bare string or an anonymous object in a list.
    const memberTitle = titleOf(member)
    if (memberTitle && typeof itemType === 'string' && asRecord(member)?.jsonType === 'object') {
      parts.push(memberTitle)
    }
    type = member
    value = item
  }

  return parts.join(' › ')
}

/**
 * The same `PathSegment[]`, rendered the way Sanity's own edit intent wants
 * it — `body[_key=="a1b2"].caption`, not `formatValidationPath`'s display
 * form. The two are deliberately separate functions: one is read by a human
 * in a row's subtitle, the other is parsed by the Studio to move a cursor,
 * and quietly using the display string for both is how a row ends up
 * focusing nothing.
 *
 * Returns `null` for a path this can't render exactly — an empty path
 * (the error is on the document itself, so there is no field to focus) or a
 * segment shape it doesn't recognize. A wrong path is worse than none: the
 * Studio would open the document and silently focus nothing, which reads as
 * the link being broken.
 *
 * Exported for its own test.
 */
export function toFocusPath(path: unknown[]): string | null {
  if (path.length === 0) return null
  // A path has to start at a named field; anything else means this isn't the
  // shape assumed here.
  if (typeof path[0] !== 'string') return null

  let out = ''
  for (const segment of path) {
    if (typeof segment === 'string') {
      out += out ? `.${segment}` : segment
    } else if (typeof segment === 'number') {
      out += `[${segment}]`
    } else if (segment && typeof segment === 'object' && '_key' in segment) {
      const {_key: key} = segment
      if (typeof key !== 'string') return null
      out += `[_key=="${key}"]`
    } else {
      return null
    }
  }
  return out
}

/**
 * Where to send an editor who clicks a row with several validation errors on
 * it: the first one that names a field. Deliberately the first rather than a
 * row per marker — a document failing six rules would otherwise become six
 * rows and swamp the list, and the subtitle already names all of them.
 *
 * Exported for its own test.
 */
export function firstErrorPath(result: ValidateDocumentResult): string | null {
  for (const marker of result.markers) {
    if (marker.level !== 'error') continue
    const path = toFocusPath(marker.path)
    if (path) return path
  }
  return null
}

/** One row's own subtitle: every `'error'`-level marker on a document, joined. Exported for its own test. */
export function summarizeErrors(
  result: ValidateDocumentResult,
  formatPath: (path: ValidateDocumentResult['markers'][number]['path']) => string = formatValidationPath,
): string | null {
  const errors = result.markers.filter((marker) => marker.level === 'error')
  if (errors.length === 0) return null
  return errors.map((marker) => `${formatPath(marker.path) || '(document)'}: ${marker.message}`).join(' · ')
}

/**
 * The plain metadata fields a row needs off a raw draft document — narrowed
 * with `typeof` guards rather than a cast, since a draft's own shape is
 * whatever its schema allows, not something this source controls.
 */
function draftMeta(
  draft: Record<string, unknown>,
  languages: readonly string[],
): {
  id: string
  type: string
  title: string
  updatedAt?: string
} {
  const id = String(draft._id)
  const type = typeof draft._type === 'string' ? draft._type : 'unknown'
  const title = toDisplayTitle(draft.title, languages) ?? (type || id)
  const updatedAt = typeof draft._updatedAt === 'string' ? draft._updatedAt : undefined
  return {id, type, title, updatedAt}
}

const TIMEOUT_MS = 10_000

/**
 * Longer timeouts for a second and third attempt at only the drafts that
 * timed out. A cold Studio load is exactly when validation is slowest — every
 * async rule (`isUnique` slug checks, reference lookups) competes with the
 * Studio's own startup requests — and a draft that times out used to be
 * dropped silently, with no retry: its finding appeared on one reload and not
 * the next (reproduced live on a real Studio). Retrying only the stragglers
 * keeps the fast findings immediate.
 */
const RETRY_TIMEOUTS_MS = [30_000, 60_000]

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
 * @public
 */
export interface DocumentValidationOptions {
  /** Candidate drafts fetched, not rows necessarily shown. Defaults to 20. */
  limit?: number
  /** Row category label. Defaults to a translated "Needs fixing"; a custom value is shown exactly as given. */
  title?: string
  /**
   * Restrict to these document types. Defaults to every content type in the
   * schema — system types (`sanity.*`) and plugin bookkeeping like
   * `translation.metadata` left out.
   */
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

/** What one validation pass over a `drafts` batch produced — see `runValidation`. */
interface ValidationRun {
  results: Map<string, ValidateDocumentResult>
  error?: Error
}

/** The empty, no-error state `useValidationResults` starts from and resets to. Module-scope, not built inline — see this file's own `AGENTS.md` rule: a `useItems` fallback whose identity changes every render is a render every render. */
const EMPTY_VALIDATION_RUN: ValidationRun = {results: new Map()}

/**
 * The actual prefetch-then-validate work for one `drafts` batch, pulled out
 * as a plain async function — not only a hook's effect body — so it can be
 * exercised directly in a test with a stub client, the same reasoning
 * `openTasks.test.ts`'s `dueSubtitleKey` comment gives for why this file's
 * own tests avoid rendering `useItems()`.
 *
 * Both awaits that can fail — the reference-existence prefetch and the
 * `mapWithConcurrency` validation pass — are individually caught below, so a
 * caller (the hook below) never has an unhandled rejection to worry about,
 * and a failure never has to look like `{results: new Map(), error:
 * undefined}` — the same shape a confident "nothing wrong" result has.
 */
export async function runValidation(
  client: SanityClient,
  schema: ReturnType<typeof useSchema>,
  currentUser: ReturnType<typeof useCurrentUser>,
  drafts: Record<string, unknown>[],
  timeoutMs: number = TIMEOUT_MS,
): Promise<ValidationRun> {
  const referenceIds = new Set<string>()
  for (const draft of drafts) collectReferenceIds(draft, referenceIds)

  // `existingIds` is `null` — an explicit "unproven" sentinel, never an
  // empty `Set` — when the prefetch itself fails. An empty `Set` would read
  // every reference as "does not exist" and invent validation errors on
  // documents that are actually fine; `null` instead tells
  // `validateDocument` below "we cannot answer" and lets every non-reference
  // rule still evaluate, the same posture `notEvaluated` already encodes
  // above at `ValidateDocumentResult['status']`.
  let existingIds: Set<string> | null
  try {
    existingIds =
      referenceIds.size > 0
        ? new Set(
            await client.fetch<string[]>('*[_id in $ids]._id', {
              ids: Array.from(referenceIds),
            }),
          )
        : new Set<string>()
  } catch (error: unknown) {
    console.error('[sanity-plugin-structure-inbox] could not prefetch reference existence', error)
    existingIds = null
  }

  // A new `const` rather than reusing the `let` above: TypeScript cannot
  // carry a `let`'s narrowing into the closure passed to `mapWithConcurrency`
  // below, since it could theoretically be reassigned before the closure
  // runs. Capturing it here makes the "is it proven?" check explicit at each
  // call, not just at the point of assignment.
  const referenceExistence = existingIds

  try {
    const validated = await mapWithConcurrency(drafts, 5, async (draft) => {
      const result = await withTimeout(
        validateDocument({
          document: draft,
          schema,
          client,
          currentUser: currentUser ?? undefined,
          // `undefined` here is not "skip reference rules": `@sanity/validation`'s
          // own typings document that omitting `getDocumentExists` falls back to
          // its own per-reference `doc` endpoint calls. Slower than our batched
          // prefetch, but still a real answer — reference rules keep evaluating,
          // just without the optimization, when the prefetch itself failed.
          getDocumentExists: referenceExistence
            ? ({id}) => Promise.resolve(referenceExistence.has(id))
            : undefined,
        }),
        timeoutMs,
        {status: 'notEvaluated' as const, markers: []},
      )
      return [String(draft._id), result] as const
    })

    return {results: new Map(validated)}
  } catch (error: unknown) {
    // `mapWithConcurrency` rejects as soon as any mapper rejects. The common
    // case (a thrown or hanging `validateDocument`) is already absorbed by
    // `withTimeout` above, but a synchronous throw while constructing the
    // call (before `withTimeout` ever sees a promise) would still surface
    // here — this catch is what covers that case too.
    console.error('[sanity-plugin-structure-inbox] validation run failed', error)
    return {results: new Map(), error: error instanceof Error ? error : new Error(String(error))}
  }
}

/**
 * Validates `drafts`, then retries only the ones that timed out
 * (`notEvaluated`) with each of `retryTimeoutsMs` in turn, reporting every
 * intermediate result through `onUpdate` so findings that came back fast show
 * immediately. Stops early once nothing is pending, on a run-level error, or
 * when `isCancelled()` says a newer batch superseded this one. Resolves with
 * how many drafts still couldn't be evaluated.
 *
 * Takes `validate` rather than calling `runValidation` itself, so the retry
 * policy is testable without a real schema. Exported for that test.
 *
 * @internal
 */
export async function validateUntilSettled(
  drafts: Record<string, unknown>[],
  validate: (drafts: Record<string, unknown>[], timeoutMs?: number) => Promise<ValidationRun>,
  onUpdate: (run: ValidationRun) => void,
  isCancelled: () => boolean,
  retryTimeoutsMs: readonly number[] = RETRY_TIMEOUTS_MS,
): Promise<number> {
  const pendingOf = (run: ValidationRun) =>
    drafts.filter((draft) => run.results.get(String(draft._id))?.status === 'notEvaluated')

  let run = await validate(drafts)
  if (isCancelled()) return 0
  onUpdate(run)

  for (const timeoutMs of retryTimeoutsMs) {
    const pending = pendingOf(run)
    if (pending.length === 0 || run.error) return 0
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: each attempt only retries what the previous one left pending.
    const retry = await validate(pending, timeoutMs)
    if (isCancelled()) return 0
    run = {results: new Map([...run.results, ...retry.results]), error: run.error ?? retry.error}
    onUpdate(run)
  }

  return run.error ? 0 : pendingOf(run).length
}

/**
 * Runs `runValidation` over `drafts` whenever the batch changes, into a
 * `Map<draftId, ValidateDocumentResult>` plus whatever error the run itself
 * hit. A validation run superseded by a newer `drafts` batch (the previous
 * effect's own cleanup sets `cancelled`) simply never applies its result —
 * there is nothing partial to unwind, the same "let it finish, ignore it"
 * posture already used elsewhere in this codebase for a stale in-flight
 * suggestion.
 */
function useValidationResults(
  client: SanityClient,
  schema: ReturnType<typeof useSchema>,
  currentUser: ReturnType<typeof useCurrentUser>,
  drafts: Record<string, unknown>[],
): ValidationRun {
  const [validationRun, setValidationRun] = useState<ValidationRun>(EMPTY_VALIDATION_RUN)

  useEffect(() => {
    if (drafts.length === 0) {
      setValidationRun(EMPTY_VALIDATION_RUN)
      return undefined
    }

    let cancelled = false

    async function run(): Promise<void> {
      const unevaluated = await validateUntilSettled(
        drafts,
        (batch, timeoutMs) => runValidation(client, schema, currentUser, batch, timeoutMs),
        setValidationRun,
        () => cancelled,
      )
      if (unevaluated > 0) {
        warnOnce(
          `documentValidation could not validate ${unevaluated} draft(s) even after retrying, ` +
            'so their errors (if any) are not shown. Their validation rules may be slow or never resolve.',
        )
      }
    }

    // `runValidation` itself never rejects — every failure it can reach
    // (the prefetch, the validation pass) is already turned into a
    // `ValidationRun` with its own `error` field. This `.catch` is the last
    // line of defense against something unanticipated slipping through
    // uncaught, so a bug here still cannot regress to the confident-empty
    // state this plan exists to prevent: it surfaces as an error too.
    void run().catch((error: unknown) => {
      console.error('[sanity-plugin-structure-inbox] validation run failed', error)
      if (!cancelled) {
        setValidationRun({
          results: new Map(),
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `client`/`schema`/`currentUser` are stable for this pane's lifetime; only a real change in `drafts` should re-run validation.
  }, [drafts])

  return validationRun
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
 *
 * @public
 */
export function documentValidation(options: DocumentValidationOptions = {}): InboxSource {
  const {limit = 20, title = 'source.documentValidation.defaultTitle', types} = options

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
      // `null` documentValue, same reasoning `unpublishedDrafts.ts` gives:
      // not scoped to one draft, since any of them could be assigned. Same
      // shared assignment record `unpublishedDrafts.ts` writes through —
      // these rows are the identical draft documents, just filtered to ones
      // currently failing validation, so "who's on this draft" has to be the
      // same fact regardless of which view surfaces it. `item.intent.params.id`
      // (the canonical, unprefixed draft id), not `item.id` (which carries the
      // `drafts.` prefix) — see `assignmentCapability.ts`'s own doc comment
      // on `targetIdFromIntentParamsId`.
      const {assigneesById, byTarget, assign} = useAssignmentCapability(client, {
        targetId: targetIdFromIntentParamsId,
      })

      const languages = useContentLanguages()
      const languageField = useDocumentLanguageField()

      const fetch$ = useMemo(() => {
        // Same default `unpublishedDrafts` uses, for the same reason: `null`
        // (every type) let through drafts nobody can act on.
        const params = {limit, types: types ?? getRealDocumentTypeNames(schema).map((type) => type.name)}
        // The `map` to `DraftsFetch` now lives inside `readDrafts$` itself,
        // not after `liveQuery$` — so `onFetchError`'s empty result and a
        // successful fetch's mapped result are the same shape by the time
        // either reaches `startWith`/`catchError` below.
        const readDrafts$ = defer(() => from(client.fetch<Record<string, unknown>[]>(QUERY, params))).pipe(
          map((drafts): DraftsFetch => ({drafts})),
        )

        return liveQuery$(client, '*[_id in path("drafts.**")]', {}, readDrafts$, (error) => ({
          drafts: [],
          error,
        })).pipe(
          startWith<DraftsFetch>({drafts: [], loading: true}),
          catchError((error: Error) => of<DraftsFetch>({drafts: [], error})),
        )
      }, [client, schema])

      const {drafts, loading, error: draftsError} = useObservable(fetch$, {drafts: [], loading: true})
      const {results, error: validationError} = useValidationResults(client, schema, currentUser, drafts)

      const items = useMemo(() => {
        const rows: InboxItem[] = []
        for (const draft of drafts) {
          const meta = draftMeta(draft, languages)
          const result = results.get(meta.id)
          if (!result || result.status !== 'failed') continue

          const subtitle = summarizeErrors(result, (path) =>
            describeValidationPath(schema, meta.type, draft, path),
          )
          if (!subtitle) continue

          const canonicalId = meta.id.replace(/^drafts\./, '')
          const focusPath = firstErrorPath(result)
          const assignedTo = byTarget.get(canonicalId)
          const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined

          const language = languageField
            ? documentLanguage(languageField, meta.type, draft[languageField.field])
            : undefined
          const row: InboxItem = {
            ...(language ? {language} : {}),
            id: meta.id,
            title: meta.title,
            subtitle,
            timestamp: meta.updatedAt,
            changedAt: meta.updatedAt,
            tone: 'critical',
            intent: {
              type: 'edit',
              params: {
                id: canonicalId,
                type: meta.type,
                ...(focusPath ? {path: focusPath} : {}),
              },
            },
          }
          rows.push(assignee ? {...row, assignee} : row)
        }
        return rows
      }, [drafts, results, byTarget, assigneesById, languages, languageField, schema])

      return {items, loading, error: draftsError ?? validationError, assign}
    },
  }
}
