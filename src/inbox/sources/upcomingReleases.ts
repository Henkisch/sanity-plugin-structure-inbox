import {CalendarIcon} from '@sanity/icons/Calendar'
import {useMemo} from 'react'
// Type-only: erased at compile time, so this never touches the runtime
// module-evaluation path `optionalHook` exists to protect against. It only
// borrows `useActiveReleases`'s shape (`ReleasesState`) for the call sites
// below — `sanity` does not export `ReleasesState` on its own.
import type {useActiveReleases as UseActiveReleasesType} from 'sanity'

import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {optionalHook} from './capability'

// `getReleaseIdFromReleaseDocumentId` strips the `_.releases.` prefix a
// release's own document id carries — the Releases tool's `release` intent
// wants the bare id (`params.id`), not the document id `release._id` already
// is. `@internal` in Sanity's own typings, same as `useActiveReleases`, so
// reached the same defensive way — see `capability.ts`. The identity
// fallback degrades to passing the untransformed id through: worst case a
// stale export means this intent 404s instead of navigating, no worse than
// the row having no `intent` at all.
const getReleaseIdFromReleaseDocumentId = optionalHook<(documentId: string) => string>(
  'getReleaseIdFromReleaseDocumentId',
  (documentId) => documentId,
)

/**
 * The Releases tool's own globally-registered intent name (`getIntentState`
 * in Sanity's `sanity/schedules` plugin maps `'release'` to
 * `{releaseId: params.id}`) — a protocol string, not an export, so it is
 * hardcoded rather than imported: even if the constant Sanity happens to
 * export under this name ever moved, the intent handler still matches on
 * this literal value.
 */
const RELEASE_INTENT = 'release'

type ReleasesState = ReturnType<typeof UseActiveReleasesType>

/**
 * Stands in for `useActiveReleases` when Sanity does not export it. A hook in
 * name only — it calls no hooks of its own — so it can substitute directly
 * for the real thing below.
 */
function useUnavailableReleases(): ReleasesState {
  return {data: [], loading: false, byId: new Map(), dispatch: () => {}}
}

// Resolved once at module scope, not inside the component: `useActiveReleases`
// is either present for the whole life of the process or absent for the whole
// life of it. `useReleases` therefore names exactly one function — the real
// hook or the fallback — for the life of the module, so `useItems` below can
// call it unconditionally on every render, which is what the rules of hooks
// require. Identity against the fallback (below) is how `useItems` tells
// whether it got the real hook.
const useReleases = optionalHook<() => ReleasesState>('useActiveReleases', useUnavailableReleases)

export interface UpcomingReleasesOptions {
  /** Cap on rows. Defaults to 5. */
  limit?: number
  title?: string
  /** Which column to render in. Defaults to `aside` — releases are context. */
  placement?: InboxSource['placement']
}

/**
 * Releases that are scheduled or still being filled.
 *
 * A release is not something this pane can complete — publishing one is a
 * deliberate act with its own confirmation, and belongs in the Releases tool —
 * so there is no `resolve` here either. A tick means "I know about this one".
 *
 * `useActiveReleases` is `@internal` in Sanity's typings, and it is the only
 * way to read releases without reimplementing their store. It is reached only
 * through `optionalHook` (see `capability.ts`), never a static import, so a
 * Sanity release that removes it degrades this source to an error result
 * instead of throwing while the barrel is evaluated and taking every consumer
 * down with it.
 */
export function upcomingReleases(options: UpcomingReleasesOptions = {}): InboxSource {
  const {limit = 5, title = 'Upcoming releases', placement = 'aside'} = options

  return {
    name: 'upcomingReleases',
    title,
    icon: CalendarIcon,
    placement,
    // A release is the same release for everybody looking at this Studio.
    audience: 'everyone',

    useItems(): InboxSourceResult {
      const {data, loading, error} = useReleases()

      const items = useMemo(
        () =>
          data.slice(0, limit).map((release): InboxItem => {
            const scheduled = release.publishAt || release.metadata.intendedPublishAt

            return {
              id: release._id,
              title: release.metadata.title || release.name,
              subtitle: release.state,
              timestamp: scheduled,
              changedAt: release._updatedAt,
              // Scheduled releases are the ones with a deadline attached, so
              // they are the ones worth colouring.
              tone: release.state === 'scheduled' ? 'primary' : 'default',
              // Opens the release itself in the Releases tool — there is
              // nothing to bulk-select or mark done here, only somewhere to
              // go look, the same as a draft or a task's own row.
              intent: {
                type: RELEASE_INTENT,
                params: {id: getReleaseIdFromReleaseDocumentId(release._id)},
              },
            }
          }),
        [data],
      )

      if (useReleases === useUnavailableReleases) {
        return {
          items: [],
          error: new Error(
            'Upcoming releases are unavailable: Sanity no longer exports useActiveReleases.',
          ),
        }
      }

      return {items, loading, error}
    },
  }
}
