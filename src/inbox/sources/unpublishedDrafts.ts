import {type SanityClient} from '@sanity/client'
import {DocumentsIcon} from '@sanity/icons/Documents'
import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {from, of} from 'rxjs'
import {catchError, map, startWith, switchMap} from 'rxjs/operators'
// `useAddonDataset` and `useUserListWithPermissions` stay out of this named
// import — see `optionalHook` in `capability.ts`.
import {
  type AddonDatasetContextValue,
  useClient,
  useCurrentUser,
  useSchema,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {API_VERSION} from '../../constants'
import {type DismissalState} from '../../store/dismissals'
import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {filterAuthoredBy} from './authoredBy'
import {optionalHook} from './capability'
import {liveQuery$} from './liveQuery'

/** Stands in for `useAddonDataset` when Sanity does not export it — see `openTasks.ts`. */
function useUnavailableAddonDataset(): AddonDatasetContextValue {
  return {
    client: null,
    isCreatingDataset: false,
    createAddonDataset: async () => null,
    ready: false,
    error: null,
  }
}

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAddonDataset = optionalHook('useAddonDataset', useUnavailableAddonDataset)
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

interface TaskTargetRow {
  _id: string
  targetId: string
  assignedTo?: string
}

/**
 * Every open task's target, regardless of which draft this source is about
 * to list — cheaper than re-running one query per row, and it's how a draft's
 * own row learns it has been handed to someone: `assign` below creates a task
 * elsewhere, and nothing before this pointed back from the task to the draft
 * it targets. Carrying the task's own `_id` here too is what lets `assign`
 * reassign the existing task instead of creating a second one pointed at the
 * same draft.
 */
const TASK_TARGETS_QUERY = `*[
  _type == "tasks.task" && status == "open" && defined(target.document._ref)
]{_id, "targetId": target.document._ref, assignedTo}`

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
 * Also offers `assign`: hands a draft to someone else by creating a
 * `tasks.task` document in the addon dataset — the same store `openTasks`
 * reads from — including a `target` reference to the draft's canonical
 * (published-style) id and type, in the exact shape Sanity's own "Create new
 * task" writes: a `_weak` `crossDatasetReference` to the content dataset,
 * plus `documentType`. Confirmed by creating one by hand, on a draft that has
 * never been published, and reading it back — Sanity points `target` at the
 * canonical id regardless, which is exactly what `_weak` is for: the
 * reference is fine to dangle until something is actually published there.
 * `tasks.task` itself is `@beta` in Sanity's own typings, same as
 * `useAddonDataset`. `useUserListWithPermissions`, which supplies who a
 * draft can go to, is `@beta` for the same reason and reached the same way.
 *
 * A draft's own row also carries `assignee` once something has assigned it —
 * `TASK_TARGETS_QUERY` reads every open task's target back out of the addon
 * dataset and joins it onto whichever draft that target's canonical id
 * matches. Without this, the only sign an assign had worked was a second,
 * disconnected "Follow up: …" row appearing elsewhere in the list — an avatar
 * appearing right where the draft already lives says the same thing without
 * the reader having to make that connection themselves.
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {
    olderThanDays = 7,
    limit = 10,
    types,
    title = 'Draft',
    placement = 'main',
    onlyMine = false,
  } = options

  /**
   * The base draft fetch, with no assignee info attached — deliberately
   * shared between `useItems` and `useOpenCount` below. Unlike the
   * assignee-join further down `useItems` goes on to do, this part needs
   * nothing from the addon dataset, which is what makes it safe for
   * `useOpenCount` to reuse: that hook exists specifically to run from a
   * place (`src/studio/inboxCountLayout.tsx`'s always-mounted provider)
   * where the addon dataset's own context is not reliably present.
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

    useOpenCount(dismissals: DismissalState, snoozes: SnoozeState, now: number): number | null {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const userId = useCurrentUser()?.id
      const result = useDraftFetch(client, schema, userId)

      return useMemo(() => {
        if (result.loading || result.error) return null
        return splitItems(result.items, 'unpublishedDrafts', dismissals, snoozes, now).open.length
      }, [result, dismissals, snoozes, now])
    },

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      const {client: addonClient} = useAddonDataset()
      // `null` documentValue: not scoped to one draft, since any of them
      // could be assigned — every project member able to update documents is
      // a sensible assignee.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

      const result = useDraftFetch(client, schema, userId)

      // Live, same reasoning as `result$`: someone assigning or closing a task
      // elsewhere should update a draft's avatar without the editor having to
      // navigate away and back.
      const openTaskByTarget$ = useMemo(() => {
        if (!addonClient) return of<Map<string, {taskId: string; assignedTo?: string}>>(new Map())

        const fetch$ = addonClient.observable.fetch<TaskTargetRow[]>(TASK_TARGETS_QUERY)

        return liveQuery$(addonClient, TASK_TARGETS_QUERY, {}, fetch$).pipe(
          map((rows) => {
            const byTarget = new Map<string, {taskId: string; assignedTo?: string}>()
            for (const row of rows) {
              byTarget.set(row.targetId, {taskId: row._id, assignedTo: row.assignedTo})
            }
            return byTarget
          }),
          catchError(() => of(new Map<string, {taskId: string; assignedTo?: string}>())),
        )
      }, [addonClient])

      const openTaskByTarget = useObservable(
        openTaskByTarget$,
        new Map<string, {taskId: string; assignedTo?: string}>(),
      )

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
            const assignedTo = canonicalId
              ? openTaskByTarget.get(canonicalId)?.assignedTo
              : undefined
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
            return assignee ? {...item, assignee} : item
          }),
        [result.items, openTaskByTarget, assigneesById],
      )

      const assess = useCallback(
        async (item: InboxItem) => {
          const message = await client.agent.action.prompt({
            instruction:
              'Given the following document:\n$document\n---\n' +
              'In one short, specific sentence: does this draft look ready to publish, ' +
              'or what looks unfinished about it?',
            instructionParams: {document: {type: 'document', documentId: item.id}},
          })
          return message
        },
        [client],
      )

      const assign = useMemo(() => {
        if (!addonClient || !assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            // `item.intent.params` already carries exactly what `target`
            // needs — the canonical (published-style) id and the schema
            // type — because `toItem` below builds it from the same row.
            // Confirmed by creating a task by hand on a draft that has never
            // been published and reading it back: Sanity points `target` at
            // that same canonical id regardless, `_weak` precisely so the
            // reference is fine to dangle until something is actually
            // published there.
            const targetId = item.intent?.params.id
            const documentType = item.intent?.params.type

            // Reassigning a draft that already has an open task pointed at
            // it updates that same task instead of creating a second one —
            // the avatar's own picker is how an already-assigned draft gets
            // reassigned, and a fresh "Follow up" task every time it fired
            // was duplicating the same one endlessly instead.
            const existingTaskId = targetId ? openTaskByTarget.get(targetId)?.taskId : undefined
            if (existingTaskId) {
              await addonClient.patch(existingTaskId).set({assignedTo}).commit()
              return
            }

            await addonClient.create({
              _type: 'tasks.task',
              title: `Follow up: ${item.title}`,
              status: 'open',
              assignedTo,
              ...(targetId &&
                documentType && {
                  target: {
                    document: {
                      _type: 'crossDatasetReference',
                      _ref: targetId,
                      _dataset: client.config().dataset,
                      _projectId: client.config().projectId,
                      _weak: true,
                    },
                    documentType,
                  },
                }),
            })
          },
          unassign: async (item: InboxItem) => {
            // Nothing to unassign if there was never a task pointed at this
            // draft to begin with — the avatar that offers "Unassign" only
            // ever shows once one exists.
            const targetId = item.intent?.params.id
            const existingTaskId = targetId ? openTaskByTarget.get(targetId)?.taskId : undefined
            if (existingTaskId)
              await addonClient.patch(existingTaskId).unset(['assignedTo']).commit()
          },
        }
      }, [addonClient, assignable, client, openTaskByTarget])

      return useMemo(() => ({...result, items, assess, assign}), [result, items, assess, assign])
    },
  }
}
