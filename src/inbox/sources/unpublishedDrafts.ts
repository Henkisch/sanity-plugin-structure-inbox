import {type SanityClient} from '@sanity/client'
import {DocumentsIcon} from '@sanity/icons/Documents'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {from, of} from 'rxjs'
import {catchError, map, startWith, switchMap} from 'rxjs/operators'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {
  useClient,
  useCurrentUser,
  useSchema,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {useAgentClient} from '../../ai/useAgentClient'
import {API_VERSION} from '../../constants'
import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {useAssignmentStore} from './assignmentStore'
import {filterAuthoredBy} from './authoredBy'
import {optionalHook} from './capability'
import {liveQuery$} from './liveQuery'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

export interface UnpublishedDraftsOptions {
  /** Only list drafts untouched for at least this long. Defaults to 7 days. */
  olderThanDays?: number
  /** Cap on rows. Defaults to 10. */
  limit?: number
  /** Restrict to these document types. Defaults to every type in the schema. */
  types?: string[]
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
  title?: string
}

const QUERY = `*[
  _id in path("drafts.**") &&
  ($types == null || _type in $types) &&
  _updatedAt < $before
] | order(_updatedAt desc)[0...$limit]{
  _id, _type, _updatedAt,
  "title": coalesce(title, name, label, _id)
}`

/**
 * This source's own private assignment doc type — see `assignmentStore.ts`
 * for the shared mechanics and why it's a plain doc, not a Sanity Task.
 */
const ASSIGNMENT_TYPE = 'structureInbox.draftAssignment'

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
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {
    olderThanDays = 7,
    limit = 10,
    types,
    title = 'Draft',
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
      const params = {before, limit, types: types ?? null}

      const toItem = (row: DraftRow): InboxItem => ({
        id: row._id,
        title: row.title || row._id,
        subtitle: schema.get(row._type)?.title || row._type,
        timestamp: row._updatedAt,
        changedAt: row._updatedAt,
        intent: {
          type: 'edit',
          // The published id is what an `edit` intent expects; the draft is
          // what it opens.
          params: {id: row._id.replace(/^drafts\./, ''), type: row._type},
        },
      })

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
          ).pipe(map((mine) => rows.filter((row) => mine.has(row._id))))
        }),
      )

      return liveQuery$(client, QUERY, params, fetch$).pipe(
        map((rows): InboxSourceResult => ({items: rows.map(toItem)})),
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

    useOpenCount(snoozes: SnoozeState, now: number): number | null {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const userId = useCurrentUser()?.id
      const result = useDraftFetch(client, schema, userId)

      return useMemo(() => {
        if (result.loading || result.error) return null
        return splitItems(result.items, 'unpublishedDrafts', snoozes, now).open.length
      }, [result, snoozes, now])
    },

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      // `null` documentValue: not scoped to one draft, since any of them
      // could be assigned — every project member able to update documents is
      // a sensible assignee.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

      const result = useDraftFetch(client, schema, userId)
      const assignments = useAssignmentStore(client, ASSIGNMENT_TYPE)

      // `assignable` already carries exactly the display name and photo an
      // avatar needs — built once here rather than looked up per row. Its own
      // `imageUrl` is not reliably populated, though, so the one entry this
      // editor can vouch for personally — themselves — uses the photo
      // `useCurrentUser` already has instead.
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

      const items = useMemo(
        () =>
          result.items.map((item): InboxItem => {
            const canonicalId = item.intent?.params.id
            const assignedTo = canonicalId ? assignments.byTarget.get(canonicalId) : undefined
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
            return assignee ? {...item, assignee} : item
          }),
        [result.items, assignments.byTarget, assigneesById],
      )

      const agentClient = useAgentClient({enabled: ai})

      const assess = useMemo(() => {
        if (!agentClient) return undefined

        return async (item: InboxItem) => {
          const message = await agentClient.agent.action.prompt({
            instruction:
              'Given the following document:\n$document\n---\n' +
              'In one short, specific sentence: does this draft look ready to publish, ' +
              'or what looks unfinished about it?',
            instructionParams: {document: {type: 'document', documentId: item.id}},
          })
          return message
        }
      }, [agentClient])

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

      return useMemo(() => ({...result, items, assess, assign}), [result, items, assess, assign])
    },
  }
}
