import {CommentIcon} from '@sanity/icons/Comment'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useAddonDataset`/`useUserListWithPermissions` stay out of this named
// import — see `optionalHook` in `capability.ts`.
import {type AddonDatasetContextValue, useClient, useCurrentUser} from 'sanity'

import {API_VERSION} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {optionalHook, useAssignableUsers} from './capability'

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

interface CommentRow {
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
      const userId = currentUser?.id
      // Resolving a thread is a task like any other this pane surfaces —
      // delegable the same way a draft or a release is, via the same
      // shared record. Deliberately the *main* dataset client
      // (`useClient`), not the addon-dataset one above: assignment
      // bookkeeping lives alongside every other source's, not inside the
      // Comments/Tasks addon dataset.
      const mainClient = useClient({apiVersion: API_VERSION})
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
      const assignments = useAssignmentStore(mainClient, ASSIGNMENT_TYPE)

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

        return defer(() => from(client.fetch<CommentRow[]>(QUERY, {limit}))).pipe(
          map((rows): CommentsFetch => ({rows})),
          startWith<CommentsFetch>({rows: [], loading: true}),
          catchError((error: Error) => of<CommentsFetch>({rows: [], error})),
        )
      }, [client, ready])

      const {rows, loading, error} = useObservable(fetch$, {rows: [] as CommentRow[], loading: true})

      const items = useMemo(() => {
        const currentUserId = currentUser?.id
        return rows
          .filter((row) => !onlyMine || (currentUserId && mentionsUser(row.message, currentUserId)))
          .map((row): InboxItem => {
            const assignedTo = assignments.byTarget.get(row._id)
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
      }, [rows, currentUser?.id, assignments.byTarget, assigneesById])

      const assign = useMemo(() => {
        if (!assignable) return undefined

        const grantedIds = new Set(assignable.filter((user) => user.granted).map((user) => user.id))

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            await assignments.assign(item.id, assignedTo)
          },
          unassign: async (item: InboxItem) => {
            await assignments.unassign(item.id)
          },
          // The thread's own `@mention`, when unambiguous — a real fact
          // (same posture `unpublishedDrafts.ts`'s "last editor" suggestion
          // uses), never enforced: resolving a thread is delegable to
          // whoever's actually doing it, not necessarily whoever was
          // mentioned.
          suggestAssignee: async (item: InboxItem) => {
            const row = rows.find((r) => r._id === item.id)
            const mentioned = row && firstMentionedUser(row.message)
            if (!mentioned || !grantedIds.has(mentioned)) return null
            return {userId: mentioned, reason: 'mentioned' as const}
          },
        }
      }, [assignable, assignments, rows])

      return {items, loading, error, assign}
    },
  }
}
