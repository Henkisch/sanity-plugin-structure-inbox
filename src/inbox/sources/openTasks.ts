import {TaskIcon} from '@sanity/icons/Task'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useAddonDataset` and `useUserListWithPermissions` stay out of this named
// import — see `optionalHook` below. `useCurrentUser` is public and stable,
// so it's imported normally.
import {type AddonDatasetContextValue, useCurrentUser, useTranslation} from 'sanity'

import {useAgentClient} from '../../ai/useAgentClient'
import {STRUCTURE_INBOX_NAMESPACE} from '../../constants'
import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {type InboxAssessment, type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {optionalHook, useAssignableUsers, useSafely} from './capability'
import {liveQuery$} from './liveQuery'
import {useOpenTaskDetail} from './openTaskDetail'

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
  /** Row category label. Defaults to a translated "Task"; a custom value is shown exactly as given. */
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
 * Which of the two `openTasks.*` i18n keys a row's due date subtitle should
 * use — `undefined` for a row with no due date at all, matching `useItems()`'s
 * own "no subtitle" case. Pulled out as its own pure function (rather than
 * inlined in the `.map()` below) so it can be unit-tested directly: this
 * source's `useItems()`/`useTaskFetch()` have no existing mock harness in
 * this test suite (unlike `documentValidation.ts`'s or `assetIssues.ts`'s own
 * pure helpers, which their `*.test.ts` files already exercise this way).
 */
export function dueSubtitleKey(dueBy?: string): 'openTasks.overdue' | 'openTasks.due' | undefined {
  if (!dueBy) return undefined
  return isOverdue(dueBy) ? 'openTasks.overdue' : 'openTasks.due'
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
 * Offers `assess` for the same reason: a task with a target reads *that*
 * document via Agent Actions (same shape `unpublishedDrafts.ts`'s own assess
 * uses), asking for a concrete next step given the task's own title — a
 * task's real substance lives in the document it's about, not in its own
 * thin fields. A task with no target (a plain reminder, nothing to open) has
 * nothing to point Agent Actions at, so it falls back to reading just the
 * task's own title instead of offering nothing at all. Needs its own
 * agent client (`useAgentClient`), separate from `client` above (the Tasks
 * addon dataset) — a task's target document never lives in the addon
 * dataset, and Agent Actions only ever reads whatever dataset its own client
 * is scoped to.
 *
 * Deliberately does NOT offer `assign`: a `tasks.task` already has exactly
 * one real assignee field, natively editable in Sanity's own Tasks UI —
 * reassigning it a second way, from this row's avatar, would just be a
 * redundant path to the same field, not a new capability. (`assignedTo` is
 * still resolved to a label/photo for *display* below, via
 * `useUserListWithPermissions` — only the write path is withheld.)
 * `unpublishedDrafts.ts` is different: a draft has no native Sanity assignee
 * at all, so `assign` there is real, not redundant.
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
    title = 'source.openTasks.defaultTitle',
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
    const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

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
      // The `map` to `RawTaskResult` now lives inside `fetch$` itself, not
      // after `liveQuery$` — so a failed refetch's `onFetchError` value and
      // a successful fetch's mapped value are the same shape by the time
      // either reaches `startWith`/`catchError` below. Wrapped in `defer`,
      // same reasoning as `assignmentStore.ts`'s own `fetch$`: a synchronous
      // throw building this pipeline becomes a catchable observable error
      // instead of an exception escaping the `useMemo`.
      const fetch$ = defer(() =>
        client.observable.fetch<TaskQueryResult>(QUERY, params).pipe(
          map(({open, cleared}): RawTaskResult => {
            const rows = [...open, ...cleared]
            return {
              items: rows.map((row): InboxItem => {
                const subtitleKey = dueSubtitleKey(row.dueBy)
                return {
                  id: row._id,
                  title: row.title || row._id,
                  subtitle: subtitleKey ? t(subtitleKey) : undefined,
                  timestamp: row.dueBy || row._updatedAt,
                  changedAt: row._updatedAt,
                  tone: isOverdue(row.dueBy) ? 'critical' : 'default',
                  overdue: isOverdue(row.dueBy),
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
                }
              }),
              // Row-level `assignedTo` from the query, kept alongside `items`
              // rather than folded into them here: resolving it to a
              // label/photo needs `assignable` (and the current user's own
              // profile for a self-match), neither of which this pipe closes
              // over — see the `items` memo below, the same two-step split
              // `unpublishedDrafts.ts` uses for the same reason.
              rowAssignees: new Map(rows.map((row) => [row._id, row.assignedTo])),
            }
          }),
        ),
      )

      // Live rather than fetched once: a task closed, reassigned, or its due
      // date changed by someone else used to only leave (or enter) this list
      // once the editor navigated away and back. A failed refetch recovers
      // to the same empty `RawTaskResult` the outer `catchError` below
      // already used to hand a `listen`-channel error — the live
      // subscription now survives the far more common refetch failure
      // instead of dying with it.
      return liveQuery$(client, QUERY, params, fetch$, (error) => ({
        items: [],
        error,
        rowAssignees: new Map(),
      })).pipe(
        startWith<RawTaskResult>({items: [], loading: true, rowAssignees: new Map()}),
        catchError((error: Error) => of<RawTaskResult>({items: [], error, rowAssignees: new Map()})),
      )
    }, [client, ready, userId, t])

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
      // A task's own target document lives in the content dataset, never
      // the Tasks addon dataset `client` above reads from — Agent Actions
      // only ever reads whatever dataset its own client is scoped to, so
      // `assess` below needs this one instead.
      const agentClient = useAgentClient()
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

      const assess = useMemo(() => {
        if (!agentClient) return undefined

        return async (item: InboxItem): Promise<InboxAssessment> => {
          const targetId = item.intent?.type === 'edit' ? item.intent.params.id : undefined
          const message = await agentClient.agent.action.prompt({
            instruction: targetId
              ? "Given the following document:\n$document\n---\nThere's an open task about it: " +
                '"$taskTitle". In one short, specific sentence, suggest a concrete next step.'
              : 'Given this task:\n$items\n---\n' +
                'In one short, specific sentence, suggest a concrete next step.',
            instructionParams: targetId
              ? {document: {type: 'document', documentId: targetId}, taskTitle: item.title}
              : {items: item.title},
          })

          // Overdue-ness is already a deterministic fact this source computed
          // for the row itself (`item.tone`, from `isOverdue` above) — reuse
          // it rather than asking the model to also judge how urgent this is.
          return item.tone === 'critical' ? {message, tone: 'critical'} : {message}
        }
      }, [agentClient])

      const openTaskDetail = useOpenTaskDetail()

      return useMemo(
        () => ({
          items,
          loading: result.loading,
          error: result.error,
          assess,
          // Only reached for a task with no target — one already has
          // `intent` (opens the target document instead), tried first. See
          // `openDetail`'s own doc comment on `InboxSourceResult`, and
          // `openTaskDetail.ts` for the stability trade-off this makes.
          openDetail: (item: InboxItem) => openTaskDetail(item.id),
          // Real assignee, deliberately read-only here — see this source's
          // own doc comment on why `assign` itself is never offered, and
          // `assigneeReadOnly`'s own doc comment for what this actually
          // changes about the row.
          assigneeReadOnly: true,
          resolve: client
            ? async (item: InboxItem) => {
                await client.patch(item.id).set({status: 'closed'}).commit()
              }
            : undefined,
          // The other half of `resolve` — powers "Mark as not done" in the
          // Cleared view. Only `openTasks` can ever populate Cleared at all
          // (see `InboxItem.cleared`'s own doc comment), so it's the only
          // source with anything real to undo here.
          reopen: client
            ? async (item: InboxItem) => {
                await client.patch(item.id).set({status: 'open'}).commit()
              }
            : undefined,
        }),
        [items, result.loading, result.error, client, assess, openTaskDetail],
      )
    },
  }
}
