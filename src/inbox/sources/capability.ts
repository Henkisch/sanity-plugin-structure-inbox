// Deliberately a namespace import, not a named one. See `optionalHook` below.
import * as sanity from 'sanity'

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
