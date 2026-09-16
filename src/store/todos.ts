export interface TodoItem {
  id: string
  title: string
  createdAt: string
  description?: string
  /** ISO date (`yyyy-mm-dd`) — a due date, not a moment, so no time of day. */
  dueBy?: string
  /**
   * Bumped by `withUpdatedTodo`. Absent on a todo nothing has ever edited —
   * lets `mergeTodos` prefer whichever copy of a conflicting id was actually
   * touched more recently, rather than an arbitrary side.
   */
  updatedAt?: string
}

export interface TodoInput {
  title: string
  description?: string
  dueBy?: string
}

/**
 * The shape stored under the todos key.
 *
 * Versioned and read defensively, same as {@link DismissalState}.
 */
export interface TodosState {
  version: 1
  items: TodoItem[]
}

export const TODOS_VERSION = 1

export const EMPTY_TODOS: TodosState = {version: TODOS_VERSION, items: []}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || !('title' in value) || !('createdAt' in value)) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
  if (typeof value.createdAt !== 'string') return false

  const description = 'description' in value ? value.description : undefined
  const dueBy = 'dueBy' in value ? value.dueBy : undefined
  const updatedAt = 'updatedAt' in value ? value.updatedAt : undefined
  return isOptionalString(description) && isOptionalString(dueBy) && isOptionalString(updatedAt)
}

/** Parses a stored value, discarding anything that is not what we wrote. */
export function parseTodos(value: unknown): TodosState {
  if (typeof value !== 'object' || value === null) return EMPTY_TODOS
  if (!('version' in value) || value.version !== TODOS_VERSION) return EMPTY_TODOS
  if (!('items' in value) || !Array.isArray(value.items)) return EMPTY_TODOS

  return {version: TODOS_VERSION, items: value.items.filter(isTodoItem)}
}

function todoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `todo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Appends a new todo. A blank (or all-whitespace) title is silently dropped. */
export function withTodo(
  state: TodosState,
  input: TodoInput,
  createdAt = new Date().toISOString(),
): TodosState {
  const title = input.title.trim()
  if (!title) return state

  const description = input.description?.trim() || undefined
  const dueBy = input.dueBy || undefined

  return {
    version: TODOS_VERSION,
    items: [...state.items, {id: todoId(), title, createdAt, description, dueBy}],
  }
}

/**
 * Edits a todo in place. A blank (or all-whitespace) title is silently
 * dropped, same as `withTodo` — better to leave the old title standing than
 * save one nobody would recognise as intentional.
 */
export function withUpdatedTodo(
  state: TodosState,
  id: string,
  input: TodoInput,
  updatedAt = new Date().toISOString(),
): TodosState {
  const title = input.title.trim()
  if (!title) return state

  const description = input.description?.trim() || undefined
  const dueBy = input.dueBy || undefined

  return {
    version: TODOS_VERSION,
    items: state.items.map((item) =>
      item.id === id ? {...item, title, description, dueBy, updatedAt} : item,
    ),
  }
}

/**
 * Removes a todo for good — not a dismissal, which only hides it while
 * leaving it in this list forever. Marking one done still goes through the
 * shared dismissal record like any other source; this is for clearing out
 * ones already finished, so the list doesn't just grow, and so a todo's
 * "done" state doesn't depend solely on a dismissal that eventually ages out
 * (see the 90-day TTL in `dismissals.ts`).
 */
export function withoutTodo(state: TodosState, id: string): TodosState {
  return {version: TODOS_VERSION, items: state.items.filter((item) => item.id !== id)}
}

/**
 * Inserts an existing `TodoItem` as-is — unlike `withTodo`, which always
 * mints a fresh `id`/`createdAt` for a brand-new one. Used only when an item
 * is *moving* between two editors' own lists (`useTodos.ts`'s `transferTo`):
 * the item already has a real identity from the sender's list, and keeping
 * it (rather than treating the move as "create a new todo") is what lets
 * `mergeTodos` resolve a conflict on the receiving side the same way it
 * would for any other edit, and lets the sender's own now-removed copy and
 * the recipient's new one be recognised as the same todo if anything ever
 * needs to reconcile the two. A todo already present with this `id` in
 * `state` is replaced rather than duplicated, the same "no double entry"
 * guarantee `mergeTodos` gives.
 */
export function withTransferredTodo(state: TodosState, item: TodoItem): TodosState {
  return {
    version: TODOS_VERSION,
    items: [...state.items.filter((existing) => existing.id !== item.id), item],
  }
}

/**
 * Unions two todo lists by id. An id present on both sides keeps whichever
 * copy's `updatedAt` is later — the same id can now genuinely differ, since
 * `withUpdatedTodo` can touch either side between a load starting and it
 * resolving. Neither side having ever been edited keeps `a`'s copy, the same
 * default as before edits existed at all.
 */
export function mergeTodos(a: TodosState, b: TodosState): TodosState {
  const byId = new Map(a.items.map((item) => [item.id, item] as const))
  for (const item of b.items) {
    const existing = byId.get(item.id)
    if (!existing || (item.updatedAt ?? '') > (existing.updatedAt ?? '')) {
      byId.set(item.id, item)
    }
  }

  return {
    version: TODOS_VERSION,
    items: [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
  }
}
