export interface TodoItem {
  id: string
  title: string
  createdAt: string
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

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false
  if (!('id' in value) || !('title' in value) || !('createdAt' in value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'string'
  )
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
  title: string,
  createdAt = new Date().toISOString(),
): TodosState {
  const trimmed = title.trim()
  if (!trimmed) return state

  return {
    version: TODOS_VERSION,
    items: [...state.items, {id: todoId(), title: trimmed, createdAt}],
  }
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
