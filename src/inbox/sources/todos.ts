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
 * Never visible to anyone but the editor who typed it: there is no shared
 * document behind a todo at all, so unlike a draft or a finding, there is
 * nobody else it could ever be handed to.
 *
 * Always `audience: 'mine'`: there is no "everyone's" reading of a todo an
 * editor typed for themselves. It has no `resolve` — there is nowhere else
 * for a todo to complete — so ticking one off only removes it from this
 * editor's own inbox, the same as any source without `resolve`.
 *
 * No `assignee` on the row, and `acknowledgable: false`: an earlier version
 * showed a self-assigned avatar here purely to look consistent with rows
 * that really do carry one — but it never responded to a click, which read
 * as broken rather than deliberate (confirmed directly: it looked
 * interactive and wasn't). A todo is already unambiguously "on you" just by
 * appearing in your own personal list, so there is nothing that avatar was
 * ever telling you that the list's existence doesn't already say. The same
 * reasoning applies to "Acknowledge": a todo has no externally-tracked
 * "still pending elsewhere" state to mark as seen-but-not-done — it is
 * either still on the list or `remove`d, nothing in between — so offering
 * that control would be a second dead click, not a real capability. Better
 * to only ever show a control that actually does something.
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
      const {state, add, remove, update} = useTodos()

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
          })),
        [state.items],
      )

      return {
        items,
        acknowledgable: false,
        create: add,
        remove: (item) => remove(item.id),
        update: (item, input) => update(item.id, input),
      }
    },
  }
}
