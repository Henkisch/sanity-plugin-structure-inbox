import {createContext, useCallback, useContext} from 'react'

import {optionalContext} from './capability'

interface TasksNavigation {
  setViewMode: (options: {type: 'edit'; id: string}) => void
  handleOpenTasks: () => void
}

// Stands in for Sanity's own `TasksNavigationContext` when it doesn't exist
// (a future version renamed or removed it, or Tasks itself isn't mounted
// around this component) — nothing ever provides a value for this one, so
// reading it always yields `null`, the same as the real context does
// whenever it has nothing to report.
const UNAVAILABLE_CONTEXT = createContext<TasksNavigation | null>(null)

/**
 * Opens a specific Sanity Task's own detail panel — the same view Sanity's
 * own Tasks UI opens one into. There is no public, documented way to do
 * this from outside that UI: `TasksNavigationContext` (from
 * `sanity/_singletons`) is the real mechanism Sanity's own components use
 * internally, explicitly marked `@internal` in Sanity's own types. Reached
 * through `optionalContext` (see `capability.ts`), never a static named
 * import, for the same reason every other `@internal`/`@beta` Sanity export
 * this plugin depends on is: Sanity can rename or remove this in any minor,
 * and a static import would turn that into a module-evaluation error taking
 * down every consumer's Studio, not just this one capability.
 *
 * Used anyway, by explicit request (see `openTasks.ts`'s own doc comment on
 * `openDetail`) — the alternative for a task with no target document was
 * nothing at all happening on click. Degrades to a silent no-op, never a
 * throw, if the context isn't there.
 */
export function useOpenTaskDetail(): (taskId: string) => void {
  const context = optionalContext('TasksNavigationContext', UNAVAILABLE_CONTEXT)
  const navigation = useContext(context)

  return useCallback(
    (taskId: string) => {
      if (!navigation) return
      navigation.setViewMode({type: 'edit', id: taskId})
      navigation.handleOpenTasks()
    },
    [navigation],
  )
}
