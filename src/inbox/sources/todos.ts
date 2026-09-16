import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'
import {useMemo} from 'react'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {
  useCurrentUser,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {useTodos} from '../../store/useTodos'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {optionalHook} from './capability'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

export interface TodosOptions {
  title?: string
  /** Which column to render in. Defaults to `main` — a todo is work. */
  placement?: InboxSource['placement']
}

function isOverdue(dueBy?: string): boolean {
  if (!dueBy) return false
  const due = Date.parse(dueBy)
  return Number.isFinite(due) && due < Date.now()
}

/**
 * A personal scratch list, kept only in this plugin's own store — nothing
 * external creates or reads these items, unlike every other built-in source.
 * Never visible to anyone but the editor who typed it (or, after a
 * `transfer`, whoever it was handed to) — there is no shared document
 * behind a todo at all, so unlike a draft or a finding there is nothing an
 * `assign` label could attach to.
 *
 * Always `audience: 'mine'`: there is no "everyone's" reading of a todo an
 * editor typed for themselves. It has no `resolve` — there is nowhere else
 * for a todo to complete — so ticking one off only removes it from this
 * editor's own inbox, the same as any source without `resolve`.
 *
 * Every row's `assignee` is always the *current viewer* — an editor's own
 * todo is unambiguously "on them" just by being in their list, and now that
 * `transfer` (below) gives that avatar something real to do on click,
 * showing it stopped being the dead click an earlier version was pulled
 * for (confirmed then: it looked interactive and wasn't — see git history
 * of this comment). `acknowledgable: false` stays: a todo has no
 * externally-tracked "still pending elsewhere" state to mark as
 * seen-but-not-done — it is either still on the list or `remove`d, nothing
 * in between — so that control would still be a dead click, unlike the
 * avatar now is.
 *
 * `transfer`, not `assign`: a todo has no shared document for a label to
 * attach to, only the acting editor's own private list, so handing one off
 * means moving its actual home rather than labeling it. Real scenario this
 * exists for: an editor leaving the team (parental leave, changing roles)
 * wanting to hand off their own open todos before they go. Reuses the same
 * per-row avatar-click picker `assign` gets elsewhere (`MergedList.tsx`
 * falls back to `transfer` there when a source has no `assign`), and the
 * same bulk "Hand off to…" picker in the selection bar. See `useTodos.ts`'s
 * own `transferTo` for the mechanics.
 *
 * `create` is what puts the "add one" control above the list; only a source
 * that keeps its own items can offer it meaningfully. `remove` deletes a
 * todo for good, once selected — separate from marking it done, which only
 * dismisses it (see `withoutTodo` for why a todo needs both).
 *
 * A due date sorts and colours the row the same way `openTasks` treats one —
 * `timestamp` prefers it over the creation time, and it goes critical once
 * past — rather than inventing a second convention for the same idea.
 */
export function todos(options: TodosOptions = {}): InboxSource {
  const {title = 'Todo', placement = 'main'} = options

  return {
    name: 'todos',
    title,
    icon: CheckmarkCircleIcon,
    placement,
    audience: 'mine',
    visibility: 'private',
    neverExpireDismissals: true,

    useItems(): InboxSourceResult {
      const {state, add, remove, update, transferTo} = useTodos()
      const currentUser = useCurrentUser()
      // `null` documentValue, same reasoning `unpublishedDrafts.ts` gives:
      // not scoped to one document, since any teammate able to write to
      // this dataset is a sensible recipient for a handed-off todo.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

      // Every row shows the current viewer as its assignee — a todo is
      // always "on" whoever's list it currently sits in, never anyone
      // else's, so this needs no per-item lookup the way a shared
      // document's real assignee does.
      const viewerAsAssignee = useMemo(
        () =>
          currentUser
            ? {
                id: currentUser.id,
                label: currentUser.name || currentUser.email || currentUser.id,
                imageUrl: currentUser.profileImage,
              }
            : undefined,
        [currentUser],
      )

      // Memoized on `state.items`, not recomputed fresh every render: this
      // result now feeds a reporting effect upstream (`SourceFeed`) keyed on
      // referential identity, and a brand-new array every render — even with
      // identical contents — would retrigger that effect every render too.
      const items: InboxItem[] = useMemo(
        () =>
          state.items.map((todo): InboxItem => ({
            id: todo.id,
            title: todo.title,
            // No `subtitle` here even when a description is set — a todo's
            // own row already carries "Todo · <relative time>" via
            // `sourceLabel`/`timestamp`; the description is for the edit
            // dialog (`description` below), not a second line to skim in a
            // dense list where every other row's second line is metadata,
            // not free text.
            timestamp: todo.dueBy || todo.createdAt,
            tone: isOverdue(todo.dueBy) ? 'critical' : 'default',
            // Exact, not the display fallback above — an edit dialog needs
            // to know whether there really is a due date, not just what to
            // show when there isn't one.
            description: todo.description,
            dueBy: todo.dueBy,
            assignee: viewerAsAssignee,
          })),
        [state.items, viewerAsAssignee],
      )

      const transfer = useMemo(() => {
        if (!assignable) return undefined

        return {
          // Excludes the current viewer, unlike `assign`'s own user lists
          // elsewhere: handing a todo to yourself is meaningless (you
          // already have it) — a real, structural difference from
          // assigning a shared document, where self-assign ("I'll take
          // this one") is completely normal.
          users: assignable
            .filter((user) => user.granted && user.id !== currentUser?.id)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, userId: string) => {
            await transferTo(item.id, userId)
          },
        }
      }, [assignable, transferTo, currentUser?.id])

      return {
        items,
        acknowledgable: false,
        create: add,
        remove: (item) => remove(item.id),
        update: (item, input) => update(item.id, input),
        transfer,
      }
    },
  }
}
