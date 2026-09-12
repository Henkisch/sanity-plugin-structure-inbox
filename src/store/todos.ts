export interface TodoItem {
  id: string
  title: string
  createdAt: string
  description?: string
  /** ISO date (`yyyy-mm-dd`) — a due date, not a moment, so no time of day. */
  dueBy?: string
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
  return isOptionalString(description) && isOptionalString(dueBy)
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
 * Unions two todo lists by id. Nothing here ever edits a todo once created, so
 * an id present on both sides is the same item on both — either side's copy
 * of it can stand.
 */
export function mergeTodos(a: TodosState, b: TodosState): TodosState {
  const byId = new Map(a.items.map((item) => [item.id, item] as const))
  for (const item of b.items) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }

  return {
    version: TODOS_VERSION,
    items: [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
  }
}
