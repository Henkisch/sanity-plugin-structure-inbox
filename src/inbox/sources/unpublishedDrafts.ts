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
 * Also offers `assign`: hands a draft to someone else by creating a plain
 * `tasks.task` document in the addon dataset — the same store `openTasks`
 * reads from. Deliberately minimal: it sets only the fields this plugin
 * itself reads (`title`, `status`, `assignedTo`), and no `target` reference
 * back to the draft, because that field's shape is not documented anywhere
 * this plugin could confirm it against — `tasks.task` is `@beta` in Sanity's
 * own typings, same as `useAddonDataset`. The created task works fully as an
 * inbox item (appears in `openTasks`, can be closed), but will not show
 * Sanity's own "linked to this document" affordance in its native Tasks UI.
 * `useUserListWithPermissions`, which supplies who a draft can go to, is
 * `@beta` for the same reason and reached the same way.
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {
    olderThanDays = 7,
    limit = 10,
    types,
    title = 'Unpublished drafts',
    placement = 'main',
    onlyMine = false,
  } = options

  return {
    name: 'unpublishedDrafts',
    title,
    icon: DocumentsIcon,
    placement,
    audience: onlyMine ? 'mine' : 'everyone',

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

      const result$ = useMemo(() => {
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

      const result = useObservable(result$, {items: [], loading: true})

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
            await addonClient.create({
              _type: 'tasks.task',
              title: `Follow up: ${item.title}`,
              status: 'open',
              assignedTo,
            })
          },
        }
      }, [addonClient, assignable])

      return useMemo(() => ({...result, assess, assign}), [result, assess, assign])
    },
  }
}
