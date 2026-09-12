import {TaskIcon} from '@sanity/icons/Task'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useAddonDataset` stays out of this named import — see `optionalHook` below.
// `useCurrentUser` is public and stable, so it is imported normally.
import {type AddonDatasetContextValue, useCurrentUser} from 'sanity'

import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {optionalHook} from './capability'
import {liveQuery$} from './liveQuery'

/**
 * Stands in for `useAddonDataset` when Sanity does not export it. A hook in
 * name only — it calls no hooks of its own — so it can substitute directly
 * for the real thing below, and `useItems` can tell the two apart by
 * identity.
 */
function useUnavailableAddonDataset(): AddonDatasetContextValue {
  return {
    client: null,
    isCreatingDataset: false,
    createAddonDataset: async () => null,
    ready: false,
    error: null,
  }
}

// Resolved once at module scope, not inside the component: `useAddonDataset`
// is either present for the whole life of the process or absent for the whole
// life of it. `useAddonDataset` below therefore names exactly one function —
// the real hook or the fallback — for the life of the module, so `useItems`
// can call it unconditionally on every render, which is what the rules of
// hooks require.
const useAddonDataset = optionalHook('useAddonDataset', useUnavailableAddonDataset)

export interface OpenTasksOptions {
  /** Cap on rows. Defaults to 10. */
  limit?: number
  title?: string
  /** Which column to render in. Defaults to `main` — tasks are the work. */
  placement?: InboxSource['placement']
  /**
   * Only list tasks assigned to this editor.
   *
   * On by default: an assigned task is the one thing in this pane that is
   * unambiguously personal. Turn it off to watch the whole team's open tasks.
   *
   * @defaultValue true
   */
  onlyMine?: boolean
}

interface TaskRow {
  _id: string
  _updatedAt: string
  title?: string
  dueBy?: string
  assignedTo?: string
}

const QUERY = `*[
  _type == "tasks.task" &&
  status == "open" &&
  defined(title) &&
  ($assignedTo == null || assignedTo == $assignedTo)
] | order(coalesce(dueBy, _updatedAt) asc)[0...$limit]{
  _id, _updatedAt, title, dueBy, assignedTo
}`

function isOverdue(dueBy?: string): boolean {
  if (!dueBy) return false
  const due = Date.parse(dueBy)
  return Number.isFinite(due) && due < Date.now()
}

/**
 * Sanity Tasks assigned to this editor and still open.
 *
 * The one source where ticking means something real: a task has a status this
 * plugin can legitimately close, so it returns `resolve` and the selection bar
 * offers "Mark as done".
 *
 * Tasks live in the Studio's addon dataset — the same one comments use — rather
 * than in the content dataset, and both `useAddonDataset` and the `tasks.task`
 * shape are marked beta in Sanity's own typings.
 *
 * Live rather than fetched once: `liveQuery$` re-runs the query whenever a
 * matching task changes, so a task someone else closes or reassigns leaves or
 * enters this list without the editor having to navigate away and back.
 *
 * `useAddonDataset` is reached only through `optionalHook` (see
 * `capability.ts`), never a static import, so a Sanity release that removes it
 * degrades this source to an error result instead of throwing while the
 * barrel is evaluated and taking every consumer down with it. That is a
 * different failure from a Studio with tasks disabled: there the export still
 * exists but there is no addon dataset to provide it, and Sanity's
 * `useAddonDataset` throws — `useAddonDataset: missing context value` —
 * rather than returning an empty result. This source does not guard against
 * that throw; the `SectionErrorBoundary` around `InboxSection` in `Inbox.tsx`
 * contains it to this source's own card instead of taking the whole pane
 * down.
 */
export function openTasks(options: OpenTasksOptions = {}): InboxSource {
  const {limit = 10, title = 'Your tasks', placement = 'main', onlyMine = true} = options

  return {
    name: 'openTasks',
    title,
    icon: TaskIcon,
    placement,
    audience: onlyMine ? 'mine' : 'everyone',

    useItems(): InboxSourceResult {
      const {client, ready} = useAddonDataset()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id

      const result$ = useMemo(() => {
        if (useAddonDataset === useUnavailableAddonDataset) {
          return of<InboxSourceResult>({
            items: [],
            error: new Error(
              'Open tasks are unavailable: Sanity no longer exports useAddonDataset.',
            ),
          })
        }

        // No addon dataset means tasks have never been used in this Studio.
        // That is not a failure, it is simply nothing to show.
        if (!client || !ready) return of<InboxSourceResult>({items: [], loading: !ready})

        const assignedTo = onlyMine ? (userId ?? null) : null
        const params = {assignedTo, limit}
        const fetch$ = client.observable.fetch<TaskRow[]>(QUERY, params)

        // Live rather than fetched once: a task closed, reassigned, or its due
        // date changed by someone else used to only leave (or enter) this list
        // once the editor navigated away and back.
        return liveQuery$(client, QUERY, params, fetch$).pipe(
          map((rows): InboxSourceResult => ({
            items: rows.map((row): InboxItem => ({
              id: row._id,
              title: row.title || row._id,
              subtitle: row.dueBy ? (isOverdue(row.dueBy) ? 'Overdue' : 'Due') : undefined,
              timestamp: row.dueBy || row._updatedAt,
              changedAt: row._updatedAt,
              tone: isOverdue(row.dueBy) ? 'critical' : 'default',
            })),
          })),
          startWith<InboxSourceResult>({items: [], loading: true}),
          catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
        )
      }, [client, ready, userId])

      const result = useObservable(result$, {items: [], loading: true})

      return useMemo(
        () => ({
          ...result,
          resolve: client
            ? async (item: InboxItem) => {
                await client.patch(item.id).set({status: 'closed'}).commit()
              }
            : undefined,
        }),
        [result, client],
      )
    },
  }
}
