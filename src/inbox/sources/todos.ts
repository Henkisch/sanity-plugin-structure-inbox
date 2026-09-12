import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'
import {useMemo} from 'react'

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
 */
export function todos(options: TodosOptions = {}): InboxSource {
  const {title = 'Your todos', placement = 'main'} = options

  return {
    name: 'todos',
    title,
    icon: CheckmarkCircleIcon,
    placement,
    audience: 'mine',

    useItems(): InboxSourceResult {
      const {state, add, remove} = useTodos()

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
          })),
        [state.items],
      )

      return {
        items,
        create: add,
        remove: (item) => remove(item.id),
      }
    },
  }
}
