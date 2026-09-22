import {type SanityClient} from '@sanity/client'
import {DocumentsIcon} from '@sanity/icons/Documents'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {from, of} from 'rxjs'
import {catchError, map, startWith, switchMap} from 'rxjs/operators'
import {useClient, useCurrentLocale, useCurrentUser, useSchema} from 'sanity'

import {AssessmentUnavailableError, parseAssessment} from '../../ai/assessment'
import {promptJson} from '../../ai/promptJson'
import {parseSnoozeSuggestion} from '../../ai/snoozeSuggestion'
import {useAgentClient} from '../../ai/useAgentClient'
import {API_VERSION} from '../../constants'
import {EMPTY_DISMISSALS, type DismissalState} from '../../store/dismissals'
import {type SnoozeState} from '../../store/snoozes'
import {warnOnce} from '../../warnOnce'
import {countOpenItems} from '../mergeItems'
import {type InboxAssessment, type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {targetIdFromIntentParamsId, useAssignmentCapability} from './assignmentCapability'
import {fetchDocumentAuthors, filterAuthoredBy} from './authoredBy'
import {liveQuery$} from './liveQuery'

/**
 * @public
 */
export interface UnpublishedDraftsOptions {
  /** Only list drafts untouched for at least this long. Defaults to 7 days. */
  olderThanDays?: number
  /** Cap on rows. Defaults to 10. */
  limit?: number
  /** Restrict to these document types. Defaults to every type in the schema. */
  types?: string[]
  /** Row category label. Defaults to a translated "Draft"; a custom value is shown exactly as given. */
  title?: string
  /** Which column to render in. Defaults to `main` — these are the work. */
  placement?: InboxSource['placement']
  /**
   * Only list drafts this editor has actually worked on.
   *
   * Off by default: a draft left unpublished is usually the team's problem
   * rather than one person's, and anyone can pick it up. Turn it on to narrow
   * the list to your own unfinished work — it costs one extra request per
   * refresh, because authorship lives in the transaction log rather than on the
   * document.
   *
   * @defaultValue false
   */
  onlyMine?: boolean
  /**
   * Offer "Ask AI" on each row.
   *
   * Defaults to `true`. Set `false` to omit it entirely — every press spends
   * an Agent Actions request, and a Studio should be able to turn that off
   * without forking this source. Also `undefined` in practice whenever Agent
   * Actions themselves are unavailable (see `useAgentClient`), in which case
   * the button is simply absent rather than present-and-erroring.
   *
   * @defaultValue true
   */
  ai?: boolean
}

interface DraftRow {
  _id: string
  _type: string
  _updatedAt: string
  // `null`, not just possibly absent: the query's own `coalesce()` returns
  // `null` for a document with no title/name/label field, never `_id`.
  title?: string | null
}

/**
 * A schema type's own display name, falling back to its raw `_type` when the
 * schema has no friendlier `title` for it (or the type isn't registered at
 * all). Exported so the title-fallback behavior below is testable without a
 * full `useItems()` render harness — see `openTasks.ts`'s `dueSubtitleKey`
 * for the same reasoning.
 */
export function typeDisplayName(schema: {get: (type: string) => {title?: string} | undefined}, type: string): string {
  return schema.get(type)?.title || type
}

const QUERY = `*[
  _id in path("drafts.**") &&
  ($types == null || _type in $types) &&
  _updatedAt < $before
] | order(_updatedAt desc)[0...$limit]{
  _id, _type, _updatedAt,
  // No \`_id\` in this chain on purpose: falling all the way back to the raw
  // document id here would make \`row.title\` always truthy, which would
  // silently defeat \`toItem\`'s own friendlier "no title at all" fallback
  // below — this needs to come back \`null\`, not a technical-looking id.
  "title": coalesce(title, name, label)
}`

/**
 * How many extra candidates to pull before filtering to `onlyMine`, since
 * `filterAuthoredBy` can only sift a batch GROQ already narrowed — it has
 * no way to ask the dataset directly for "documents I authored." A fixed
 * multiplier, not a loop: bounded and predictable, at the cost of still
 * being able to under-report in an extreme case (see this file's own
 * Maintenance notes).
 */
const ONLY_MINE_OVERFETCH_MULTIPLIER = 5

/**
 * Drafts that have sat unpublished long enough to look forgotten.
 *
 * Deliberately plain GROQ over the Studio's own dataset: no addon dataset, no
 * internal store, nothing a future Studio release can move.
 *
 * Live rather than fetched once: a draft published, or edited back under the
 * threshold, by someone else in another tab used to only leave this list once
 * the editor navigated away and back. `liveQuery$` re-runs the query whenever
 * a matching document changes instead.
 *
 * Ticking one cannot publish it — publishing has validation, permissions and
 * side effects this pane has no business performing — so this source has no
 * `resolve`, and a tick reads as "stop showing me this".
 *
 * Offers `assess`: a one-line read from Sanity's Agent Actions on whether a
 * given draft looks ready to publish. Informational only — it never writes
 * to the document, so there is nothing here to guard behind `resolve`.
 *
 * Also offers `assign` — hands a draft to someone else. **Deliberately not**
 * implemented as a Sanity Task: an earlier version of this created a real
 * `tasks.task` document per assignment, which (a) surfaced as a second,
 * separately-titled "Follow up: …" row that this plugin has spent a whole
 * design pass arguing editors should never have to reconcile with the actual
 * draft it was about, (b) needed the addon dataset at all, for a feature that
 * has nothing to do with Sanity's own Tasks concept, and (c) had a real,
 * observed bug: reassigning a draft that already had one of these tasks did
 * not reliably find and reuse it, so a fresh "Follow up" task was created on
 * every single assign click. Assignment is now just a plain, unregistered
 * document (`structureInbox.draftAssignment.<targetId>`) mapping a draft's
 * canonical id to an assignee id — the same shape and the same reasoning
 * `useDismissals.ts` already uses for its own per-user preference doc, kept
 * in the content dataset this source already reads, nothing borrowed from
 * Sanity's Tasks feature at all. `useUserListWithPermissions`, which supplies
 * who a draft can go to, is `@beta` in Sanity's own typings and reached via
 * `optionalHook` for exactly that reason.
 *
 * A draft's own row also carries `assignee` once something has assigned it —
 * `ASSIGNMENTS_QUERY` reads every assignment doc back out and joins it onto
 * whichever draft its `targetId` matches.
 *
 * @public
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {
    olderThanDays = 7,
    limit = 10,
    types,
    title = 'source.unpublishedDrafts.defaultTitle',
    placement = 'main',
    onlyMine = false,
    ai = true,
  } = options

  /**
   * The base draft fetch, with no assignee info attached — deliberately
   * shared between `useItems` and `useOpenCount` below.
   */
  function useDraftFetch(
    client: SanityClient,
    schema: ReturnType<typeof useSchema>,
    userId: string | undefined,
  ): InboxSourceResult {
    const result$ = useMemo(() => {
      // Read once per `[client, schema, userId]` recompute, same as this
      // logic did inline inside `useItems()` before this hook was extracted
      // — not a live clock, just this fetch's own "as of now" cutoff.
      // eslint-disable-next-line react/purity -- see comment above
      const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
      const rawLimit = onlyMine ? limit * ONLY_MINE_OVERFETCH_MULTIPLIER : limit
      const params = {before, limit: rawLimit, types: types ?? null}

      const toItem = (row: DraftRow): InboxItem => {
        // A draft can exist with no title at all (that's exactly what
        // `documentValidation` flags it for) — the raw `_id` is never a
        // fair fallback for a row title, so this falls back to the same
        // friendly type name the subtitle already computes.
        const typeName = typeDisplayName(schema, row._type)
        return {
          id: row._id,
          title: row.title || typeName,
          subtitle: typeName,
          timestamp: row._updatedAt,
          changedAt: row._updatedAt,
          intent: {
            type: 'edit',
            // The published id is what an `edit` intent expects; the draft is
            // what it opens.
            params: {id: row._id.replace(/^drafts\./, ''), type: row._type},
          },
        }
      }

      // The `map` to `InboxSourceResult` now lives inside `fetch$` itself,
      // not after `liveQuery$` — so `onFetchError`'s empty result and a
      // successful fetch's mapped result are the same shape by the time
      // either reaches `startWith`/`catchError` below.
      const fetch$ = client.observable.fetch<DraftRow[]>(QUERY, params).pipe(
        switchMap((rows) => {
          // Without a user there is nobody to filter by, so listing
          // everything beats listing nothing.
          if (!onlyMine || !userId || rows.length === 0) return of(rows)

          return from(
            filterAuthoredBy(
              client,
              rows.map((row) => row._id),
              userId,
            ),
          ).pipe(
            map((mine) => rows.filter((row) => mine.has(row._id)).slice(0, limit)),
            catchError((error: unknown) => {
              // The source's own posture, two branches up: listing everything
              // beats listing nothing. A failed history read should cost the
              // `onlyMine` filter, not the whole card — the history endpoint
              // varies by plan and retention, and this batches up to
              // `limit * ONLY_MINE_OVERFETCH_MULTIPLIER` ids into one URL.
              warnOnce(
                'unpublishedDrafts could not read document history, so `onlyMine` is not being applied — ' +
                  "showing everyone's drafts instead of none.",
              )
              console.error('[sanity-plugin-structure-inbox] onlyMine filter failed', error)
              // The over-fetch (`ONLY_MINE_OVERFETCH_MULTIPLIER`) exists only
              // because the filter is expected to remove rows — without this
              // cap, a failure would show up to 5x the requested count.
              return of(rows.slice(0, limit))
            }),
          )
        }),
        map((rows): InboxSourceResult => ({items: rows.map(toItem)})),
      )

      return liveQuery$(client, QUERY, params, fetch$, (error) => ({items: [], error})).pipe(
        startWith<InboxSourceResult>({items: [], loading: true}),
        catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
      )
    }, [client, schema, userId])

    return useObservable(result$, {items: [], loading: true})
  }

  return {
    name: 'unpublishedDrafts',
    title,
    icon: DocumentsIcon,
    placement,
    audience: onlyMine ? 'mine' : 'everyone',

    useOpenCount(
      snoozes: SnoozeState,
      now: number,
      dismissals: DismissalState = EMPTY_DISMISSALS,
    ): number | null {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const userId = useCurrentUser()?.id
      const result = useDraftFetch(client, schema, userId)

      return useMemo(() => {
        if (result.loading || result.error) return null
        // `countOpenItems`, not `splitItems(...).open.length`: this source
        // has no `resolve` at all, so a dismissal is the *only* way one of
        // its rows ever leaves the pane's Open view (`mergeRows`) — a count
        // that ignored dismissals could therefore never reach zero.
        // `acknowledgable` left at its default: `useItems` never sets it.
        return countOpenItems(result.items, 'unpublishedDrafts', snoozes, now, dismissals)
      }, [result, snoozes, now, dismissals])
    },

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      const result = useDraftFetch(client, schema, userId)
      // `null` documentValue: not scoped to one draft, since any of them
      // could be assigned — every project member able to update documents is
      // a sensible assignee. `item.intent.params.id` (the canonical,
      // unprefixed draft id), not `item.id` (which carries the `drafts.`
      // prefix) — see `assignmentCapability.ts`'s own doc comment on
      // `targetIdFromIntentParamsId`.
      const {
        assigneesById,
        byTarget,
        assign: baseAssign,
        assignable,
      } = useAssignmentCapability(client, {targetId: targetIdFromIntentParamsId})

      const items = useMemo(
        () =>
          result.items.map((item): InboxItem => {
            const canonicalId = item.intent?.params.id
            const assignedTo = canonicalId ? byTarget.get(canonicalId) : undefined
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
            return assignee ? {...item, assignee} : item
          }),
        [result.items, byTarget, assigneesById],
      )

      const agentClient = useAgentClient({enabled: ai})

      const assess = useMemo(() => {
        if (!agentClient) return undefined

        return async (item: InboxItem): Promise<InboxAssessment> => {
          const raw = await promptJson<unknown>(
            agentClient,
            'Given the following document:\n$document\n---\n' +
              'Assess whether this draft looks ready to publish.\n' +
              'Answer with JSON only, no prose and no code fences, in this exact shape:\n' +
              '{"message": "<one short, specific sentence>", "tone": "<one of: positive, caution, critical>"}\n' +
              'Use "positive" when it looks ready, "caution" when something is thin or ' +
              'unpolished, "critical" when something required is plainly missing. Name the ' +
              'specific thing rather than describing the document in general.',
            {document: {type: 'document', documentId: item.id}},
          )

          const assessment = parseAssessment(raw)
          if (!assessment) throw new AssessmentUnavailableError()
          return assessment
        }
      }, [agentClient])

      const locale = useCurrentLocale()
      // A valid IANA zone always exists per the runtime — this is a real
      // environment read, not a Sanity API, so nothing here needs the
      // `optionalHook` defensiveness.
      const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

      const suggestSnooze = useMemo(() => {
        if (!agentClient) return undefined

        return async (item: InboxItem) => {
          const raw = await promptJson<unknown>(
            agentClient,
            'Given the following document:\n$document\n---\n' +
              'If this document is about something with a date — an event, a launch, a ' +
              'deadline, an embargo — when would an editor next want to look at it?\n' +
              'Answer with JSON only, no prose and no code fences:\n' +
              '{"until": "<ISO 8601 instant>", "reason": "<a few words>"}\n' +
              'If the document says nothing about timing, answer {"until": null}. ' +
              'Do not guess.',
            {document: {type: 'document', documentId: item.id}},
            {localeSettings: {locale: locale.id, timeZone}},
          )
          return parseSnoozeSuggestion(raw, Date.now())
        }
      }, [agentClient, locale, timeZone])

      // `baseAssign` already has `users`/`toUser`/`unassign` from the shared
      // hook — this only adds the one piece specific to this source: whoever
      // most recently touched the draft, from the transaction log — a fact,
      // not a guess. Dropped rather than offered when that person isn't (or
      // is no longer) assignable, the same fallback `assignedTo` already gets
      // elsewhere in this source.
      const assign = useMemo(() => {
        if (!baseAssign) return undefined

        const grantedIds = new Set((assignable ?? []).filter((user) => user.granted).map((user) => user.id))

        return {
          ...baseAssign,
          suggestAssignee: async (item: InboxItem) => {
            let authors: Map<string, string[]>
            try {
              authors = await fetchDocumentAuthors(client, [item.id])
            } catch (error) {
              // No suggestion beats a wrong one, and beats an error the
              // editor cannot act on: this is an optional convenience on top
              // of the same history endpoint `onlyMine` reads, so the same
              // degradation applies — lose the feature, not the row.
              warnOnce(
                'unpublishedDrafts could not read document history, so suggestAssignee is unavailable.',
              )
              console.error('[sanity-plugin-structure-inbox] suggestAssignee history read failed', error)
              return null
            }
            const mostRecentAuthor = authors.get(item.id)?.[0]
            if (!mostRecentAuthor || !grantedIds.has(mostRecentAuthor)) return null
            return {userId: mostRecentAuthor, reason: 'lastEditor' as const}
          },
        }
      }, [baseAssign, assignable, client])

      return useMemo(
        () => ({...result, items, assess, suggestSnooze, assign}),
        [result, items, assess, suggestSnooze, assign],
      )
    },
  }
}
