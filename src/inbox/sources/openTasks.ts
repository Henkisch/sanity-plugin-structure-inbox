import {TaskIcon} from '@sanity/icons/Task'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useAddonDataset` and `useUserListWithPermissions` stay out of this named
// import — see `optionalHook` below. `useCurrentUser` is public and stable,
// so it is imported normally.
import {
  type AddonDatasetContextValue,
  useCurrentUser,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {optionalHook, useSafely} from './capability'
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

/** Stands in for `useUserListWithPermissions` when Sanity does not export it — see `unpublishedDrafts.ts`. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope, not inside the component: `useAddonDataset`
// is either present for the whole life of the process or absent for the whole
// life of it. `useAddonDataset` below therefore names exactly one function —
// the real hook or the fallback — for the life of the module, so `useItems`
// can call it unconditionally on every render, which is what the rules of
// hooks require.
const useAddonDataset = optionalHook('useAddonDataset', useUnavailableAddonDataset)
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

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
  /**
   * How far back a closed task still counts toward Cleared — older closures
   * simply age out of the query, the same way a dismissal already ages out
   * after `DISMISSAL_TTL_DAYS`. This is the only place a task's own resolved
   * state can be shown at all: unlike a dismissal, there is no separate
   * per-editor record of "this got cleared" to fall back on.
   *
   * @defaultValue 7
   */
  clearedWithinDays?: number
}

interface TaskRow {
  _id: string
  _updatedAt: string
  title?: string
  dueBy?: string
  assignedTo?: string
  status: string
  targetId?: string
  targetType?: string
}

// Two independently-capped slices, not one combined order-then-slice: a
// closed row's only meaningful recency is *when it closed*, the opposite
// direction from an open row's "how soon is it due" — sharing one
// ascending `coalesce(dueBy, _updatedAt)` sort put the two on the same
// axis, and a project with `limit` or more open tasks silently sliced the
// task someone had just closed off the end of the array entirely (found by
// closing one live and watching it vanish from both tabs, not from reading
// the query). Each bucket keeps its own natural order and its own `limit`,
// so one can never crowd the other out.
const QUERY = `{
  "open": *[
    _type == "tasks.task" &&
    defined(title) &&
    ($assignedTo == null || assignedTo == $assignedTo) &&
    status == "open"
  ] | order(coalesce(dueBy, _updatedAt) asc)[0...$limit]{
    _id, _updatedAt, title, dueBy, assignedTo, status,
    "targetId": target.document._ref,
    "targetType": target.documentType
  },
  "cleared": *[
    _type == "tasks.task" &&
    defined(title) &&
    ($assignedTo == null || assignedTo == $assignedTo) &&
    status == "closed" &&
    _updatedAt > $clearedSince
  ] | order(_updatedAt desc)[0...$limit]{
    _id, _updatedAt, title, dueBy, assignedTo, status,
    "targetId": target.document._ref,
    "targetType": target.documentType
  }
}`

interface TaskQueryResult {
  open: TaskRow[]
  cleared: TaskRow[]
}

/**
 * `useItems`'s own intermediate shape, before `assignedTo` ids are resolved
 * to a label/photo — see the `items` memo further down, which turns this
 * into the `InboxSourceResult` the source actually returns.
 */
interface RawTaskResult extends InboxSourceResult {
  rowAssignees: Map<string, string | undefined>
}

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
 * Clicking a row opens the task's own `target` document, when it has one —
 * the same `type: 'edit'` intent a draft's own row uses — rather than doing
 * nothing: a task's own fields (a title, a due date) are thin next to the
 * document it's actually about.
 *
 * Also offers `assign`: the avatar on a task's own row reassigns it directly.
 * `useUserListWithPermissions`, which supplies who it can go to, is `@beta`
 * in Sanity's own typings, same as `useAddonDataset`.
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
  const {
    limit = 10,
    title = 'Task',
    placement = 'main',
    onlyMine = true,
    clearedWithinDays = 7,
  } = options

  /**
   * The base task fetch — deliberately shared between `useItems` and
   * `useOpenCount` below, since both need exactly this and nothing else
   * (`useOpenCount` doesn't resolve `assignedTo` ids to a label/photo, only
   * `useItems` does, further down).
   */
  function useTaskFetch(
    client: AddonDatasetContextValue['client'],
    ready: boolean,
    userId: string | undefined,
  ): RawTaskResult {
    const result$ = useMemo(() => {
      if (useAddonDataset === useUnavailableAddonDataset) {
        return of<RawTaskResult>({
          items: [],
          error: new Error('Open tasks are unavailable: Sanity no longer exports useAddonDataset.'),
          rowAssignees: new Map(),
        })
      }

      // No addon dataset means tasks have never been used in this Studio.
      // That is not a failure, it is simply nothing to show.
      if (!client || !ready) {
        return of<RawTaskResult>({items: [], loading: !ready, rowAssignees: new Map()})
      }

      const assignedTo = onlyMine ? (userId ?? null) : null
      // eslint-disable-next-line react/purity -- see `unpublishedDrafts.ts`'s own `before`: read once per recompute, not a live clock.
      const clearedSince = new Date(Date.now() - clearedWithinDays * 24 * 60 * 60 * 1000).toISOString()
      const params = {assignedTo, limit, clearedSince}
      const fetch$ = client.observable.fetch<TaskQueryResult>(QUERY, params)

      // Live rather than fetched once: a task closed, reassigned, or its due
      // date changed by someone else used to only leave (or enter) this list
      // once the editor navigated away and back.
      return liveQuery$(client, QUERY, params, fetch$).pipe(
        map(({open, cleared}): RawTaskResult => {
          const rows = [...open, ...cleared]
          return {
            items: rows.map((row): InboxItem => ({
              id: row._id,
              title: row.title || row._id,
              subtitle: row.dueBy ? (isOverdue(row.dueBy) ? 'Overdue' : 'Due') : undefined,
              timestamp: row.dueBy || row._updatedAt,
              changedAt: row._updatedAt,
              tone: isOverdue(row.dueBy) ? 'critical' : 'default',
              // A task's own title is thin ("Follow up: X") — the document
              // it targets is the substantial thing to look at, so clicking
              // the row opens that instead of an editor for the task itself.
              intent:
                row.targetId && row.targetType
                  ? {type: 'edit', params: {id: row.targetId, type: row.targetType}}
                  : undefined,
              // Real, Sanity-confirmed evidence, not a dismissal — see `cleared`
              // on `InboxItem`. This is the one source that can set it at all.
              cleared: row.status === 'closed',
            })),
            // Row-level `assignedTo` from the query, kept alongside `items`
            // rather than folded into them here: resolving it to a
            // label/photo needs `assignable` (and the current user's own
            // profile for a self-match), neither of which this pipe closes
            // over — see the `items` memo below, the same two-step split
            // `unpublishedDrafts.ts` uses for the same reason.
            rowAssignees: new Map(rows.map((row) => [row._id, row.assignedTo])),
          }
        }),
        startWith<RawTaskResult>({items: [], loading: true, rowAssignees: new Map()}),
        catchError((error: Error) => of<RawTaskResult>({items: [], error, rowAssignees: new Map()})),
      )
    }, [client, ready, userId])

    return useObservable(result$, {items: [], loading: true, rowAssignees: new Map()})
  }

  return {
    name: 'openTasks',
    title,
    icon: TaskIcon,
    placement,
    audience: onlyMine ? 'mine' : 'everyone',

    useOpenCount(snoozes: SnoozeState, now: number): number | null {
      // Tasks live in the addon dataset, so unlike `unpublishedDrafts.ts`
      // (whose base query needs nothing from it), there is no count here at
      // all without `useAddonDataset` — this can't be worked around the way
      // that source's `useOpenCount` was. `useSafely` (see `capability.ts`)
      // returns the "unavailable" fallback instead of throwing when its
      // context isn't mounted here, so this reports `null` (does not
      // contribute to the total) rather than crashing the count provider —
      // which today, from `src/studio/inboxCountLayout.tsx`'s
      // `studio.components.layout` slot, it always will, since that context
      // has only been confirmed present inside the structure tool's own
      // resolved pane tree.
      const {client, ready} = useSafely(useAddonDataset, useUnavailableAddonDataset())
      const userId = useCurrentUser()?.id
      const result = useTaskFetch(client, ready, userId)

      return useMemo(() => {
        if (result.loading || result.error) return null
        return splitItems(result.items, 'openTasks', snoozes, now).open.length
      }, [result, snoozes, now])
    },

    useItems(): InboxSourceResult {
      const {client, ready} = useAddonDataset()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      // `null` documentValue: not scoped to one task, since any of them could
      // be reassigned — see `unpublishedDrafts.ts`, which reaches the same
      // hook the same way for the same reason.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

      const result = useTaskFetch(client, ready, userId)

      // Every assignable project member, keyed by id — same shape and same
      // reasoning as `unpublishedDrafts.ts`'s own `assigneesById`: `assignable`
      // has everyone's display name and photo except a reliable one for the
      // current user, whose own profile fills that gap instead.
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
            const assignedTo = result.rowAssignees.get(item.id)
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
            return assignee ? {...item, assignee} : item
          }),
        [result.items, result.rowAssignees, assigneesById],
      )

      // Lets the avatar on a task's own row reassign it directly — the same
      // `assign` shape `unpublishedDrafts` offers, but a plain patch here
      // rather than a create-or-patch: every row this source lists is
      // already a task, never a document standing in for one.
      const assign = useMemo(() => {
        if (!client || !assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            await client.patch(item.id).set({assignedTo}).commit()
          },
          unassign: async (item: InboxItem) => {
            await client.patch(item.id).unset(['assignedTo']).commit()
          },
        }
      }, [client, assignable])

      return useMemo(
        () => ({
          items,
          loading: result.loading,
          error: result.error,
          resolve: client
            ? async (item: InboxItem) => {
                await client.patch(item.id).set({status: 'closed'}).commit()
              }
            : undefined,
          assign,
        }),
        [items, result.loading, result.error, client, assign],
      )
    },
  }
}
