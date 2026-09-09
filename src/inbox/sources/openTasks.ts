import {TaskIcon} from '@sanity/icons/Task'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
import {useAddonDataset, useCurrentUser} from 'sanity'

import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'

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
 * shape are marked beta in Sanity's own typings. Both are confined to this
 * file: if either moves, this one source stops working rather than the plugin.
 * A Studio with tasks disabled has no addon dataset at all, and Sanity's
 * `useAddonDataset` throws — `useAddonDataset: missing context value` — rather
 * than returning an empty result. This source does not guard against that; the
 * `SectionErrorBoundary` around `InboxSection` in `Inbox.tsx` contains the
 * throw to this source's own card instead of taking the whole pane down.
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
        // No addon dataset means tasks have never been used in this Studio.
        // That is not a failure, it is simply nothing to show.
        if (!client || !ready) return of<InboxSourceResult>({items: [], loading: !ready})

        const assignedTo = onlyMine ? (userId ?? null) : null

        return client.observable.fetch<TaskRow[]>(QUERY, {assignedTo, limit}).pipe(
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
