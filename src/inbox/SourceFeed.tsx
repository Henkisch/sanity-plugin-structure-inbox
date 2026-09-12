import {useEffect, useMemo, useRef} from 'react'

import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {splitItems} from './splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from './types'

/** Everything `MergedList` needs from one source, for every view at once. */
export interface SourceReport extends Omit<InboxSourceResult, 'items' | 'loading'> {
  source: InboxSource
  loading?: boolean
  open: InboxItem[]
  done: InboxItem[]
  snoozed: InboxItem[]
}

interface SourceFeedProps {
  source: InboxSource
  dismissals: Dismissals
  snoozes: Snoozes
  /** Shared across every source feed, so all of them split on the same instant. */
  now: number
  onReport: (sourceName: string, report: SourceReport) => void
}

/**
 * Runs one source's `useItems` and reports the result upward instead of
 * rendering anything — `MergedList` is what draws rows, for every main
 * source's items merged into one list. Still one component per source, so
 * each keeps the stable hook order the rules of hooks require, and (via the
 * `SectionErrorBoundary` wrapping it in `Inbox.tsx`) its own failure domain:
 * a throw here costs this source's rows, never the whole list.
 */
export function SourceFeed(props: SourceFeedProps) {
  const {source, dismissals, snoozes, now, onReport} = props
  const {items, loading, error, resolve, create, assess, assign, remove} = source.useItems()

  const {open, done, snoozed} = useMemo(
    () => splitItems(items, source.name, dismissals.state, snoozes.state, now),
    [items, source.name, dismissals.state, snoozes.state, now],
  )

  // `resolve`/`create`/`assess`/`assign`/`remove` are read through a ref
  // rather than named directly in the effect's own dependency list below:
  // at least one
  // built-in source gets `assign` from a Sanity hook
  // (`useUserListWithPermissions`) that does not promise a stable reference
  // across renders, and depending on the object itself would report on every
  // render whether anything actually changed or not — which sets state,
  // which renders again, which reports again, forever.
  //
  // The dependency list instead uses a small "fingerprint" of each
  // capability — whether it's present, and (for `assign`) how many people it
  // offers — so the effect only re-fires on a real transition (a capability
  // appearing, disappearing, or the assignee list actually changing size),
  // never on a same-shaped object getting a new identity. The ref still
  // holds the actual functions, updated in their own effect that (being
  // declared first) always runs before this one in the same commit, so a
  // firing report always reads the latest ones.
  const capabilities = useRef({resolve, create, assess, assign, remove})
  useEffect(() => {
    capabilities.current = {resolve, create, assess, assign, remove}
  })

  const hasResolve = Boolean(resolve)
  const hasCreate = Boolean(create)
  const hasAssess = Boolean(assess)
  const hasRemove = Boolean(remove)
  const assignUserCount = assign?.users.length ?? -1

  useEffect(() => {
    onReport(source.name, {source, loading, error, open, done, snoozed, ...capabilities.current})
  }, [
    onReport,
    source,
    loading,
    error,
    open,
    done,
    snoozed,
    hasResolve,
    hasCreate,
    hasAssess,
    hasRemove,
    assignUserCount,
  ])

  return null
}
