import {CommentIcon} from '@sanity/icons/Comment'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useAddonDataset` stays out of this named import — see `optionalHook` in
// `capability.ts`.
import {type AddonDatasetContextValue, useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {targetIdFromItemId, useAssignmentCapability} from './assignmentCapability'
import {optionalHook} from './capability'

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

// Resolved once at module scope, not inside the component — same reasoning
// `openTasks.ts` gives for its own `useAddonDataset` resolution.
const useAddonDataset = optionalHook('useAddonDataset', useUnavailableAddonDataset)

/**
 * How many extra threads to pull before filtering to `onlyMine`, same
 * reasoning and same value `unpublishedDrafts.ts`'s own
 * `ONLY_MINE_OVERFETCH_MULTIPLIER` uses for the identical problem: `QUERY`
 * can only ask the dataset for "the newest N open threads team-wide," never
 * "the newest N that mention me," so without over-fetching first, a real
 * `@mention` of the current editor sitting outside the newest `limit`
 * threads team-wide was silently invisible to them — confirmed live, not
 * theoretical: on any team with `limit` or more open threads, this was the
 * one thing this source exists for (an editor asking "what's on me right
 * now") quietly not working.
 */
const ONLY_MINE_OVERFETCH_MULTIPLIER = 5

/**
 * The `$limit` this source's own query actually asks the dataset for —
 * pulled out as its own pure function, the same reason `openTasks.ts`
 * extracts `dueSubtitleKey`: this file's `useItems()` calls
 * `useAddonDataset`/`useClient`/`useCurrentUser`/`useAssignableUsers`, none
 * of which have an existing render-level mock harness in this test suite,
 * so the actual fetch-limit and filter logic needs to be testable on its
 * own, without one.
 */
export function commentsFetchLimit(limit: number, onlyMine: boolean): number {
  return onlyMine ? limit * ONLY_MINE_OVERFETCH_MULTIPLIER : limit
}

/**
 * The rows this source actually keeps, once the wider `commentsFetchLimit`
 * over-fetch has come back — filters to `onlyMine`, then re-caps to the
 * *configured* `limit` (not the wider one just fetched). Same reasoning as
 * `commentsFetchLimit` above for why this is its own pure function.
 */
export function selectUnresolvedComments(
  rows: readonly CommentRow[],
  onlyMine: boolean,
  currentUserId: string | undefined,
  limit: number,
): CommentRow[] {
  return rows
    .filter((row) => !onlyMine || (currentUserId && mentionsUser(row.message, currentUserId)))
    .slice(0, limit)
}

export interface UnresolvedCommentsOptions {
  /** Cap on rows. Defaults to 20. */
  limit?: number
  /** Row category label. Defaults to a translated "Unresolved comment"; a custom value is shown exactly as given. */
  title?: string
  /**
   * Only threads mentioning the current editor, mirroring `openTasks`'s
   * own default. Off shows every unresolved thread team-wide.
   *
   * @defaultValue true
   */
  onlyMine?: boolean
}

/**
 * A Portable Text span, as this plugin ever needs to read one back: enough
 * to tell a plain `span` from a `mention` node and to concatenate the
 * former into a title. Not the real `@portabletext/types` shape — this
 * plugin doesn't depend on that package, and the comment API's own
 * `.d.ts` (`@sanity/client`) types a message block's children generically
 * (`{_type: string, [key: string]: unknown}`) anyway.
 */
interface CommentMessageChild {
  _type: string
  text?: string
  userId?: string
}

interface CommentMessageBlock {
  _type: string
  children?: CommentMessageChild[]
}

/**
 * The plain-text of a comment's own first line — same "first line only"
 * choice `documentValidation.ts`'s `summarizeErrors` makes for a row's own
 * subtitle: a comment thread can run long, and a row only has room for a
 * title, not the whole conversation. Exported for its own test.
 */
export function firstLineOfMessage(message: CommentMessageBlock[]): string {
  const text = message
    .flatMap((block) => block.children ?? [])
    .map((child) => child.text ?? '')
    .join('')
    .trim()

  const firstLine = text.split('\n')[0] ?? ''
  return firstLine || '(no text)'
}

/** Whether any child across `message`'s blocks is a `mention` naming `userId`. Exported for its own test. */
export function mentionsUser(message: CommentMessageBlock[], userId: string): boolean {
  return message.some((block) =>
    (block.children ?? []).some((child) => child._type === 'mention' && child.userId === userId),
  )
}

/**
 * The first `@mention`ed user in `message`, if exactly one distinct user is
 * mentioned — a real, evidenced candidate for `suggestAssignee` (same
 * reasoning `unpublishedDrafts.ts`'s own "last editor" suggestion uses: a
 * fact this source can point to, not a guess). A thread mentioning more than
 * one person has no single obvious assignee, so this returns `undefined`
 * rather than picking one arbitrarily. Exported for its own test.
 */
export function firstMentionedUser(message: CommentMessageBlock[]): string | undefined {
  const mentionedIds: string[] = []
  for (const block of message) {
    for (const child of block.children ?? []) {
      if (child._type === 'mention' && child.userId) mentionedIds.push(child.userId)
    }
  }

  const mentioned = new Set(mentionedIds)
  return mentioned.size === 1 ? mentionedIds[0] : undefined
}

export interface CommentRow {
  _id: string
  _createdAt: string
  message: CommentMessageBlock[]
  target: {
    document: {_ref: string}
    documentType: string
    path?: {field?: string}
  }
}

interface CommentsFetch {
  rows: CommentRow[]
  loading?: boolean
  error?: Error
}

const QUERY = `*[
  _type == "comment" &&
  status == "open" &&
  !defined(parentCommentId)
] | order(_createdAt desc)[0...$limit]{
  _id, _createdAt, message, target
}`

/**
 * Unresolved comment threads — something neither Sanity's own Structure
 * Tool nor this plugin surfaced in aggregate before this source. Comments
 * (a paid, Growth-plan-and-above feature) live in the same per-project
 * add-on dataset Tasks already uses (`useAddonDataset`, confirmed live by
 * reading a real comment document's own shape against the test dataset —
 * *not* `@sanity/client`'s org-scoped `collaboration.comments` API, which
 * is a separate, `@alpha`, org-store-gated surface this source
 * deliberately does not depend on). Reusing the exact mechanism
 * `openTasks.ts` already proves means this degrades the same way that
 * source already does on a project with no add-on dataset yet: a Free-tier
 * project (Comments unavailable at all), or a Growth/Enterprise project
 * that has simply never had a comment or task left, both just show zero
 * rows rather than erroring — this source works, or quietly does nothing,
 * across every plan tier without special-casing any of them.
 *
 * v1 scope: only root threads (no replies), only `status == 'open'`
 * (resolving a thread has its own UX in the Studio's own comment panel —
 * this pane never resolves one itself). `onlyMine` (default `true`)
 * narrows to threads mentioning the current editor, the same default
 * `openTasks` uses for the same reason: a team-wide unfiltered feed of
 * every open comment would be noisy for an inbox meant to answer "what's
 * on me right now."
 *
 * No `resolve`, no AI: resolving is a Studio UI action this pane doesn't
 * reimplement, and there is nothing here for an AI read to add — a
 * comment already says what it means.
 */
export function unresolvedComments(options: UnresolvedCommentsOptions = {}): InboxSource {
  const {limit = 20, title = 'source.unresolvedComments.defaultTitle', onlyMine = true} = options

  return {
    name: 'unresolvedComments',
    title,
    icon: CommentIcon,
    placement: 'main',
    audience: onlyMine ? 'mine' : 'everyone',

    useItems(): InboxSourceResult {
      const {client, ready} = useAddonDataset()
      const currentUser = useCurrentUser()
      // Resolving a thread is a task like any other this pane surfaces —
      // delegable the same way a draft or a release is, via the same
      // shared record. Deliberately the *main* dataset client
      // (`useClient`), not the addon-dataset one above: assignment
      // bookkeeping lives alongside every other source's, not inside the
      // Comments/Tasks addon dataset. `item.id` is this source's own comment
      // thread id (`row._id`) — see `assignmentCapability.ts`'s own doc
      // comment on `targetIdFromItemId`.
      const mainClient = useClient({apiVersion: API_VERSION})
      const {
        assigneesById,
        byTarget,
        assign: baseAssign,
        assignable,
      } = useAssignmentCapability(mainClient, {targetId: targetIdFromItemId})

      const fetch$ = useMemo(() => {
        if (useAddonDataset === useUnavailableAddonDataset) {
          return of<CommentsFetch>({
            rows: [],
            error: new Error('Unresolved comments are unavailable: Sanity no longer exports useAddonDataset.'),
          })
        }

        // No add-on dataset yet — a Free-tier project (Comments/Tasks never
        // available), or a paid one where nobody has left a comment or task
        // yet. Either way, nothing to show, not an error.
        if (!ready || !client) return of<CommentsFetch>({rows: [], loading: !ready})

        const rawLimit = commentsFetchLimit(limit, onlyMine)
        return defer(() => from(client.fetch<CommentRow[]>(QUERY, {limit: rawLimit}))).pipe(
          map((rows): CommentsFetch => ({rows})),
          startWith<CommentsFetch>({rows: [], loading: true}),
          catchError((error: Error) => of<CommentsFetch>({rows: [], error})),
        )
      }, [client, ready])

      const {rows, loading, error} = useObservable(fetch$, {rows: [] as CommentRow[], loading: true})

      const items = useMemo(() => {
        const currentUserId = currentUser?.id
        return selectUnresolvedComments(rows, onlyMine, currentUserId, limit)
          .map((row): InboxItem => {
            const assignedTo = byTarget.get(row._id)
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined

            const item: InboxItem = {
              id: row._id,
              title: firstLineOfMessage(row.message),
              subtitle: `${row.target.documentType} · ${row.target.path?.field ?? 'document'}`,
              timestamp: row._createdAt,
              tone: 'default',
              // `inspect`/`comment` match the deep link Sanity's own comment
              // notification emails already use (confirmed by reading a real
              // comment document's own `context.notification.url`) — opens
              // the document with the Comments panel already open, scrolled
              // to this exact thread, not just the document on its own.
              intent: {
                type: 'edit',
                params: {
                  id: row.target.document._ref,
                  type: row.target.documentType,
                  inspect: 'sanity/comments',
                  comment: row._id,
                },
              },
            }
            if (assignee) item.assignee = assignee
            return item
          })
      }, [rows, currentUser?.id, byTarget, assigneesById])

      // `baseAssign` already has `users`/`toUser`/`unassign` from the shared
      // hook — this only adds the one piece specific to this source: the
      // thread's own `@mention`, when unambiguous (a real fact, same posture
      // `unpublishedDrafts.ts`'s own "last editor" suggestion uses), never
      // enforced — resolving a thread is delegable to whoever's actually
      // doing it, not necessarily whoever was mentioned.
      const assign = useMemo(() => {
        if (!baseAssign) return undefined

        const grantedIds = new Set((assignable ?? []).filter((user) => user.granted).map((user) => user.id))

        return {
          ...baseAssign,
          suggestAssignee: async (item: InboxItem) => {
            const row = rows.find((r) => r._id === item.id)
            const mentioned = row && firstMentionedUser(row.message)
            if (!mentioned || !grantedIds.has(mentioned)) return null
            return {userId: mentioned, reason: 'mentioned' as const}
          },
        }
      }, [baseAssign, assignable, rows])

      return {items, loading, error, assign}
    },
  }
}
