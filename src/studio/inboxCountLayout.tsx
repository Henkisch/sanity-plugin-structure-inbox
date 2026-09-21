import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'
import {type LayoutProps} from 'sanity'

import {type SnoozeState} from '../store/snoozes'
import {useDismissals, type Dismissals} from '../store/useDismissals'
import {useSnoozes, type Snoozes} from '../store/useSnoozes'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'
import {type InboxSource} from '../inbox/types'
import {type ResolvedStructureInboxConfig} from '../types'

interface SharedInboxStore {
  dismissals: Dismissals
  snoozes: Snoozes
  /**
   * Per-source reset counters, keyed by `source.name` — passed as
   * `SectionErrorBoundary`'s `resetKey` prop both here (`OpenCountFeed`'s own
   * boundary, below) and in `Inbox.tsx` (`BoundedSourceFeed`'s). Owned here,
   * not in `Inbox.tsx`, because this provider outlives any particular mount
   * of the pane — a source's entry survives the editor closing and reopening
   * the Structure tool, so a retry the pane already spent doesn't come back
   * for free just by remounting `Inbox.tsx`. A source with no entry yet has
   * simply never been retried.
   */
  sourceRetryKeys: Record<string, number>
  /**
   * Bumps `sourceRetryKeys[sourceName]`, giving every `SectionErrorBoundary`
   * watching that key (this provider's own `OpenCountFeed` boundary, and
   * `Inbox.tsx`'s `BoundedSourceFeed` for the pane, when mounted) a chance to
   * reset — bounded by each boundary's own independent `MAX_RESETS`, not by
   * this counter. One user click (the pane's "Try again") therefore also
   * gives the always-mounted navbar-count boundary a chance to recover the
   * same source, instead of leaving the badge under-reporting after the
   * editor already fixed it from the pane. This is the one deliberately
   * *shared* trigger the plan allows for the count provider — no timer, no
   * polling, only ever driven by an explicit click somewhere.
   */
  retrySource: (sourceName: string) => void
}

/**
 * Not exported from `src/index.ts` — this is the plumbing that lets
 * `Inbox.tsx` and this plan's always-mounted provider share one
 * `useDismissals`/`useSnoozes` instance instead of two independent ones.
 * Two independent instances would each keep their own copy of what's
 * dismissed/snoozed — the moment an editor dismisses something through the
 * pane, a separate copy elsewhere would have no way to find out, silently
 * drifting stale. `Inbox.tsx` is only ever reached through the `structure`
 * resolver `structureInbox()` itself wraps (`src/plugin.tsx`), and this
 * provider is unconditionally registered by that same plugin, so
 * `Inbox.tsx` can assume this context is always present — there is no
 * supported way to reach `Inbox.tsx` without it.
 */
const SharedInboxStoreContext = createContext<SharedInboxStore | null>(null)

/** Read by `Inbox.tsx` instead of calling `useDismissals`/`useSnoozes` itself. */
export function useSharedInboxStore(): SharedInboxStore {
  const store = useContext(SharedInboxStoreContext)
  if (!store) {
    throw new Error(
      '[sanity-plugin-structure-inbox] Inbox rendered without its layout provider. ' +
        'This should not be reachable outside structureInbox() itself.',
    )
  }
  return store
}

const InboxOpenCountContext = createContext<number | null>(null)

/**
 * How many things are open across every configured `main` source that
 * defines `useOpenCount` (see `InboxSource.useOpenCount`) — live, available
 * without mounting the Inbox pane. `null` until this plugin's layout
 * provider (wired up automatically by `structureInbox()`) has reported at
 * least once.
 *
 * A source without `useOpenCount` simply does not contribute to this total
 * — see that field's own comment in `src/inbox/types.ts` for why this
 * provider deliberately does not fall back to a source's full `useItems()`
 * to fill the gap (that used to crash here: `unpublishedDrafts.ts` and
 * `openTasks.ts` each call Sanity's `useAddonDataset`, whose required
 * context is only reliably present *inside* the structure tool's own
 * resolved pane tree, not at this plugin's `studio.components.layout` slot
 * — confirmed by reproducing the crash, not just suspected).
 *
 * @public
 */
export function useInboxOpenCount(): number | null {
  return useContext(InboxOpenCountContext)
}

interface OpenCountFeedProps {
  source: InboxSource
  snoozes: SnoozeState
  now: number
  onCount: (sourceName: string, count: number | null) => void
}

/**
 * Mounts one source's `useOpenCount`, reporting whatever it returns. Only
 * ever rendered for a source that actually defines `useOpenCount` — see
 * `InboxCountLayout` below.
 *
 * Wrapped in its own `SectionErrorBoundary` (the same boundary
 * `BoundedSourceFeed` in `Inbox.tsx` uses) as defense in depth: this
 * plugin's own two built-in `useOpenCount` implementations are known-safe,
 * but a third party's custom source could still throw here for some
 * reason this plugin doesn't control, and one such source should not be
 * able to take the whole count provider down.
 */
function OpenCountFeed(props: OpenCountFeedProps) {
  const {source, snoozes, now, onCount} = props
  const count = source.useOpenCount?.(snoozes, now) ?? null

  useEffect(() => {
    onCount(source.name, count)
  }, [source.name, count, onCount])

  return null
}

/**
 * Builds the `studio.components.layout` override that owns the one shared
 * `useDismissals`/`useSnoozes` instance (see `useSharedInboxStore`) and
 * exposes a live open count via `useInboxOpenCount()` — both available for
 * the whole time the Studio is open, not only while the Inbox pane is.
 */
export function createInboxCountLayout(config: ResolvedStructureInboxConfig) {
  const mainSources = config.sources.filter((source) => (source.placement ?? 'main') === 'main')
  const countableSources = mainSources.filter((source) => source.useOpenCount)
  const neverExpireDismissalSources = mainSources
    .filter((source) => source.neverExpireDismissals)
    .map((source) => source.name)

  return function InboxCountLayout(props: LayoutProps) {
    const dismissals = useDismissals(neverExpireDismissalSources)
    const snoozes = useSnoozes()

    // Same 60s tick `Inbox.tsx` uses for its own open/snoozed split — see
    // that file's identical comment for why: a snoozed item needs to wake on
    // its own without user interaction to prompt a re-render.
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 60_000)
      return () => clearInterval(id)
    }, [])

    const [counts, setCounts] = useState<Record<string, number | null>>({})
    const handleCount = useCallback((sourceName: string, count: number | null) => {
      setCounts((current) =>
        current[sourceName] === count ? current : {...current, [sourceName]: count},
      )
    }, [])

    const openCount = useMemo(
      () => countableSources.reduce((total, source) => total + (counts[source.name] ?? 0), 0),
      [counts],
    )

    const [sourceRetryKeys, setSourceRetryKeys] = useState<Record<string, number>>({})
    const retrySource = useCallback((sourceName: string) => {
      setSourceRetryKeys((current) => ({...current, [sourceName]: (current[sourceName] ?? 0) + 1}))
    }, [])

    const store = useMemo<SharedInboxStore>(
      () => ({dismissals, snoozes, sourceRetryKeys, retrySource}),
      [dismissals, snoozes, sourceRetryKeys, retrySource],
    )

    return (
      <SharedInboxStoreContext.Provider value={store}>
        <InboxOpenCountContext.Provider value={openCount}>
          {countableSources.map((source) => (
            <SectionErrorBoundary
              fallback={null}
              key={source.name}
              onCatch={() => handleCount(source.name, null)}
              resetKey={sourceRetryKeys[source.name]}
            >
              <OpenCountFeed now={now} onCount={handleCount} snoozes={snoozes.state} source={source} />
            </SectionErrorBoundary>
          ))}
          {props.renderDefault(props)}
        </InboxOpenCountContext.Provider>
      </SharedInboxStoreContext.Provider>
    )
  }
}
