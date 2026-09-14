import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'
import {useMemo} from 'react'
import {useCurrentUser} from 'sanity'

import {useTodos} from '../../store/useTodos'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'

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
 *
 * Always `audience: 'mine'`: there is no "everyone's" reading of a todo an
 * editor typed for themselves. It has no `resolve` — there is nowhere else
 * for a todo to complete — so ticking one off only removes it from this
 * editor's own inbox, the same as any source without `resolve`.
 *
 * `create` is what puts the "add one" control above the list; only a source
 * that keeps its own items can offer it meaningfully. `remove` deletes a
 * todo for good, once selected — separate from marking it done, which only
 * dismisses it (see `withoutTodo` for why a todo needs both).
 *
 * A due date sorts and colours the row the same way `openTasks` treats one —
 * `timestamp` prefers it over the creation time, and it goes critical once
 * past — rather than inventing a second convention for the same idea.
 *
 * Every row also carries `assignee`, set to this editor themselves — not
 * because a todo can be handed to anyone else, but so it shows the same
 * avatar every other row does instead of falling back to restating "Assigned
 * to you" in text nowhere else does anymore. No `assign` capability, though:
 * the avatar renders here, but plainly, with nothing to click.
 */
export function todos(options: TodosOptions = {}): InboxSource {
  const {title = 'Todo', placement = 'main'} = options

  return {
    name: 'todos',
    title,
    icon: CheckmarkCircleIcon,
    placement,
    audience: 'mine',
    neverExpireDismissals: true,

    useItems(): InboxSourceResult {
      const {state, add, remove, update} = useTodos()
      const currentUser = useCurrentUser()

      // Memoized on `state.items`, not recomputed fresh every render: this
      // result now feeds a reporting effect upstream (`SourceFeed`) keyed on
      // referential identity, and a brand-new array every render — even with
      // identical contents — would retrigger that effect every render too.
      const items: InboxItem[] = useMemo(
        () =>
          state.items.map((todo): InboxItem => ({
            id: todo.id,
            title: todo.title,
            subtitle: todo.description,
            timestamp: todo.dueBy || todo.createdAt,
            tone: isOverdue(todo.dueBy) ? 'critical' : 'default',
            // Exact, not the display fallback above — an edit dialog needs
            // to know whether there really is a due date, not just what to
            // show when there isn't one.
            description: todo.description,
            dueBy: todo.dueBy,
            assignee: currentUser
              ? {id: currentUser.id, label: currentUser.name, imageUrl: currentUser.profileImage}
              : undefined,
          })),
        [state.items, currentUser],
      )

      return {
        items,
        create: add,
        remove: (item) => remove(item.id),
        update: (item, input) => update(item.id, input),
      }
    },
  }
}
