import {useEffect, useMemo, useRef} from 'react'

import {type Snoozes} from '../store/useSnoozes'
import {splitItems} from './splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from './types'

/** Everything `MergedList` needs from one source, for every view at once. */
export interface SourceReport extends Omit<InboxSourceResult, 'items' | 'loading'> {
  source: InboxSource
  loading?: boolean
  open: InboxItem[]
  cleared: InboxItem[]
  snoozed: InboxItem[]
}

interface SourceFeedProps {
  source: InboxSource
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
  const {source, snoozes, now, onReport} = props
  const {
    items,
    loading,
    error,
    resolve,
    reopen,
    create,
    assess,
    proposeFix,
    assign,
    assigneeReadOnly,
    remove,
    update,
    openDetail,
    action,
    acknowledgable,
  } = source.useItems()

  const {open, cleared, snoozed} = useMemo(
    () => splitItems(items, source.name, snoozes.state, now),
    [items, source.name, snoozes.state, now],
  )

  // This destructure is a hardcoded allowlist, not `...rest` — every new
  // field `InboxSourceResult` gains (`proposeFix`, `assigneeReadOnly`,
  // `openDetail`, and `reopen` itself — found missing here well after it
  // shipped, silently making "Mark as not done" a dead click the whole
  // time — all found this out the hard way) has to be added here,
  // to `capabilities` below, and to its own `has*`/fingerprint entry in the
  // effect's dependency list, or it never reaches `MergedList` at all: it
  // silently drops out right here, at the one place every source's result
  // funnels through before `onReport`.
  //
  // `resolve`/`create`/`assess`/`assign`/`remove`/`update` are read through a
  // ref rather than named directly in the effect's own dependency list below:
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
  const capabilities = useRef({
    resolve,
    reopen,
    create,
    assess,
    proposeFix,
    assign,
    assigneeReadOnly,
    remove,
    update,
    openDetail,
    action,
    acknowledgable,
  })
  useEffect(() => {
    capabilities.current = {
      resolve,
      reopen,
      create,
      assess,
      proposeFix,
      assign,
      assigneeReadOnly,
      remove,
      update,
      openDetail,
      action,
      acknowledgable,
    }
  })

  const hasResolve = Boolean(resolve)
  const hasReopen = Boolean(reopen)
  const hasCreate = Boolean(create)
  const hasAssess = Boolean(assess)
  const hasProposeFix = Boolean(proposeFix)
  const hasRemove = Boolean(remove)
  const hasUpdate = Boolean(update)
  const hasOpenDetail = Boolean(openDetail)
  const hasAction = Boolean(action)
  const assignUserCount = assign?.users.length ?? -1
  const isAssigneeReadOnly = Boolean(assigneeReadOnly)
  const isAcknowledgable = acknowledgable !== false

  useEffect(() => {
    onReport(source.name, {source, loading, error, open, cleared, snoozed, ...capabilities.current})
  }, [
    onReport,
    source,
    loading,
    error,
    open,
    cleared,
    snoozed,
    hasResolve,
    hasReopen,
    hasCreate,
    hasAssess,
    hasProposeFix,
    hasRemove,
    hasUpdate,
    hasOpenDetail,
    hasAction,
    assignUserCount,
    isAssigneeReadOnly,
    isAcknowledgable,
  ])

  return null
}
