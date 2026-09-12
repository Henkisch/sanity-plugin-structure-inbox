import {CheckmarkCircleIcon} from '@sanity/icons/CheckmarkCircle'

import {useTodos} from '../../store/useTodos'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'

export interface TodosOptions {
  title?: string
  /** Which column to render in. Defaults to `main` — a todo is work. */
  placement?: InboxSource['placement']
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
 * `create` is what puts the inline "add one" input above the list; only a
 * source that keeps its own items can offer it meaningfully.
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
      const {state, add} = useTodos()

      const items: InboxItem[] = state.items.map((todo): InboxItem => ({
        id: todo.id,
        title: todo.title,
        timestamp: todo.createdAt,
      }))

      return {items, create: add}
    },
  }
}
