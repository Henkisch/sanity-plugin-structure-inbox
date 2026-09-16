// Deliberately a namespace import, not a named one. See `optionalHook` below.
import * as sanity from 'sanity'
// `sanity/_singletons` is where Sanity keeps every cross-cutting internal
// React Context (`TasksNavigationContext` among them) — same reasoning as
// the namespace import above, for `optionalContext` further down.
import * as sanitySingletons from 'sanity/_singletons'
// These two are Sanity's own exported *types*, not the `@beta` value export
// itself — safe to import by name directly (see `optionalHook`'s own doc
// comment on why only value exports need the namespace-import treatment).
import {
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

/**
 * Looks up a Sanity export that this plugin cannot rely on existing.
 *
 * Some Sanity APIs the shipped sources depend on (`useAddonDataset`,
 * `useActiveReleases`) are marked `@beta`, `@internal` or `@hidden` in
 * Sanity's own typings — Sanity reserves the right to rename or remove them
 * in any v6 minor. A *named* import of one of these
 * (`import {useAddonDataset} from 'sanity'`) turns that rename into a
 * module-evaluation error: the ESM runtime throws while evaluating the
 * importing module, the moment the named binding is missing. Because this
 * package re-exports every source from its barrel (`src/index.ts`), that
 * throw would happen while evaluating the barrel itself — taking down every
 * consumer's Studio, including one that configured neither source.
 *
 * A namespace import (`import * as sanity from 'sanity'`, above) does not
 * have this failure mode: it succeeds regardless of which named properties
 * are present, so reading the property off the namespace object at call time
 * — rather than binding it at import time — survives the export being gone.
 *
 * Trade-off, stated plainly: this gives up compile-time checking at the call
 * site. TypeScript cannot tell you `optionalHook('useAddonDataset')` still
 * refers to something real, and a typo in `name` fails silently (as
 * `undefined`) instead of as a type error. In exchange, the plugin survives
 * the export disappearing at runtime. Callers must treat the result as
 * possibly `undefined` and degrade — report an error result, do not throw —
 * rather than assuming presence.
 *
 * The rule this helper exists to enforce: any Sanity API marked `@beta`,
 * `@internal` or `@hidden` must be reached through this function, never a
 * static named import.
 *
 * Takes a `fallback` rather than returning `T | undefined` so a call site can
 * hand in a stand-in of the same shape (see `upcomingReleases.ts` and
 * `openTasks.ts`) and always get back something callable — which keeps a hook
 * looked up this way safe to call unconditionally, satisfying the rules of
 * hooks, instead of forcing every call site to branch on whether the lookup
 * succeeded before it can call anything.
 */
export function optionalHook<T>(name: string, fallback: T): T {
  const value = Reflect.get(sanity, name)
  return typeof value === 'function' ? value : fallback
}

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

/**
 * Resolved once at module scope, shared by every assignable source —
 * `useUserListWithPermissions` is `@beta` in Sanity's own typings, reached
 * only through `optionalHook` for the reason this file's own top comment
 * explains. Previously redeclared identically in 9 separate source files;
 * consolidated here so a rename only needs one edit.
 */
export const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

/**
 * Same reasoning as `optionalHook` above, generalized to a plain (non-hook)
 * export from an arbitrary namespace-imported module, not only `sanity`
 * itself. `@sanity/validation`'s `validateDocument` is a `@beta` export of a
 * different package — the same "reserves the right to rename or remove"
 * risk `optionalHook` exists for, but not something `optionalHook` itself
 * can reach, since it is hardcoded to the `sanity` namespace specifically.
 *
 * Callers pass their own `import * as ns from '...'` namespace object,
 * keeping the same failure mode `optionalHook` already accepts: a rename
 * degrades to `fallback` at call time, never a module-evaluation throw.
 */
export function optionalExport<T>(namespace: object, name: string, fallback: T): T {
  const value = Reflect.get(namespace, name)
  return typeof value === 'function' ? value : fallback
}

/**
 * Same reasoning as `optionalHook` above, for a Sanity export that isn't a
 * hook — a React Context object, from `sanity/_singletons` (see the
 * namespace import at the top of this file). Every context there is marked
 * `@internal`: Sanity's own components use it, but makes no promise it will
 * keep existing under this name, or at all. `fallback` should be another
 * real (but never-provided) Context of the same shape — see
 * `openTaskDetail.ts` for the pattern — so `useContext` still has something
 * valid to call unconditionally, satisfying the rules of hooks, instead of
 * every call site branching on whether the lookup succeeded before it can
 * call anything.
 */
export function optionalContext<T>(name: string, fallback: T): T {
  const value = Reflect.get(sanitySingletons, name)
  // eslint-disable-next-line no-unsafe-type-assertion -- same trade-off as `optionalHook` above: the caller's own `fallback` type is the only contract there is for a dynamically-looked-up export.
  return value === undefined ? fallback : (value as T)
}

/**
 * Calls `hook` and returns `fallback` instead of letting it throw.
 *
 * For a hook whose *export* might not exist, use `optionalHook` above
 * instead — this is for one whose export exists but throws when its
 * required context isn't mounted at the call site. Sanity's own
 * `useAddonDataset` does this (`useAddonDataset: missing context value`),
 * which matters here because this plugin's always-mounted count provider
 * (`src/studio/inboxCountLayout.tsx`) sits at the Studio's
 * `studio.components.layout` slot — outside the structure tool's own
 * resolved pane tree, which is the only place that context is reliably
 * provided (confirmed by reproducing the crash from that slot).
 *
 * Safe to wrap a hook call in try/catch here specifically because
 * `useAddonDataset`'s throw happens *after* its one internal `useContext`
 * call already returned (a plain `if (!ctx) throw ...` in its own body) —
 * catching it does not leave any hook mid-flight, so React's hook-call
 * bookkeeping for this component is unaffected. This is not a general
 * license to wrap arbitrary hooks in try/catch; do not reuse this for a
 * hook whose internals aren't understood this precisely.
 */
export function useSafely<T>(hook: () => T, fallback: T): T {
  try {
    return hook()
  } catch {
    return fallback
  }
}
