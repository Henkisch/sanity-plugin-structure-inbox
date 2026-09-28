import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {toDisplayTitle} from '../i18n/contentText'
import {useContentLanguages} from '../i18n/useContentLanguages'
import {type Snoozes} from '../store/useSnoozes'
import {warnOnce} from '../warnOnce'
import {splitItems} from './splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from './types'
import {useStableItems} from './useStableItems'

/** Everything `MergedList` needs from one source, for every view at once. */
export interface SourceReport extends Omit<InboxSourceResult, 'items' | 'loading'> {
  source: InboxSource
  loading?: boolean
  /**
   * A `loadMore` page is on its way. The rows already on screen are held
   * meanwhile (see `SourceFeed`), so `loading` stays false and the list
   * doesn't collapse to "Loading…"; this is what the footer's own spinner
   * reads instead.
   */
  loadingMore?: boolean
  open: InboxItem[]
  cleared: InboxItem[]
  snoozed: InboxItem[]
}

/**
 * Whether a freshly built report says anything new, compared field by field
 * with `===`.
 *
 * A backstop for the loop `useStableItems` already closes one step earlier:
 * every value in a report is either a primitive, a capability the source owns,
 * or one of the three arrays derived from stable `items`, so identity is a
 * fair test here and an unchanged report can be dropped without storing it.
 * The always-mounted count provider (`createInboxCountLayout`'s own
 * `handleCount`) has had this guard from the start; the pane's own report path
 * never did.
 *
 * @internal
 */
export function sameReport(a: SourceReport | undefined, b: SourceReport): boolean {
  if (a === b) return true
  if (!a) return false

  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Reflect.get(a, key) !== Reflect.get(b, key)) return false
  }
  return true
}

/**
 * `items` with every `title`/`subtitle` guaranteed to be a string (or, for
 * `subtitle`, absent) — the same array back, by identity, when that already
 * holds, which is every render of every well-behaved source.
 *
 * Both fields are typed `string`, but a source's data comes from a dataset,
 * not from TypeScript: a built-in once passed a localized title
 * (`[{_key, language, value}]`) straight through, and rendering that as a
 * React child throws. Every consumer downstream of here — row text, the
 * headline, Ask's prompt, the edit dialog's prefill — assumes a string, so
 * this is the one place that makes it true, for integrators' sources as well
 * as the built-ins.
 *
 * @internal
 */
export function normalizeItemText(
  items: InboxItem[],
  languages: readonly string[],
  untitled: string,
  onFixed?: () => void,
): InboxItem[] {
  const needsFix = (item: InboxItem) =>
    typeof item.title !== 'string' ||
    (item.subtitle !== undefined && typeof item.subtitle !== 'string')
  if (!items.some(needsFix)) return items

  onFixed?.()
  return items.map((item) => {
    if (!needsFix(item)) return item
    const title = toDisplayTitle(item.title, languages) ?? untitled
    const subtitle =
      item.subtitle === undefined ? undefined : (toDisplayTitle(item.subtitle, languages) ?? undefined)
    return {...item, title, subtitle}
  })
}

/**
 * Every field of `InboxSourceResult` that is a *capability* — i.e. everything
 * except the data (`items`) and the load state (`loading`/`error`).
 *
 * This union exists so that forgetting to wire a new capability is a
 * `npm run typecheck` failure instead of a silent dead click. It has happened
 * four times (`proposeFix`, `assigneeReadOnly`, `openDetail`, `reopen` — the
 * last of which made "Mark as not done" inert for a whole release), because
 * every capability on `InboxSourceResult` is optional, so TypeScript accepts a
 * report with any subset of them present.
 */
type CapabilityKey = keyof Omit<InboxSourceResult, 'items' | 'overflow' | 'loading' | 'error'>

/** See the hold in `SourceFeed` — how long a "Show more" may keep its spinner with nothing arriving. */
const LOAD_MORE_TIMEOUT_MS = 20_000

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
  const result = source.useItems()

  // Not `result.items` directly: a source is free to build its items fresh on
  // every render (the shape the README documents, and the shape any hand-written
  // source naturally takes), and a new array identity every render would re-fire
  // the report effect below forever — see `useStableItems`' own doc comment for
  // the crash this prevents.
  const stableItems = useStableItems(result.items, source.name)
  const languages = useContentLanguages()
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const untitled = t('row.untitled')
  const items = useMemo(
    () =>
      normalizeItemText(stableItems, languages, untitled, () =>
        warnOnce(
          `Source "${source.name}" returned an item whose title or subtitle is not a string ` +
            `(a localized field value, perhaps). It was converted to text for display; ` +
            `return strings from useItems to control what is shown.`,
        ),
      ),
    [stableItems, languages, untitled, source.name],
  )

  const {
    loading: sourceLoading,
    error,
    overflow,
    loadMore: sourceLoadMore,
    resolve,
    reopen,
    create,
    assess,
    proposeFix,
    assign,
    assigneeReadOnly,
    suggestSnooze,
    remove,
    update,
    openDetail,
    action,
    acknowledgable,
    transfer,
  } = result

  // Holding the rows on screen while a `loadMore` page loads. A source that
  // pages by rebuilding its query with a higher limit starts that query over
  // from `{items: [], loading: true}`, and passed straight through, the whole
  // list would drop to "Loading…" and back on every "Show more" click, losing
  // the editor's place. So between the click and the next settled result,
  // the last settled rows stand in for the source's empty loading ones.
  //
  // "Settled" is whichever comes first: the source loaded (seen loading, then
  // not), its rows or its overflow changed (a source that pages
  // synchronously never reports loading at all), or `LOAD_MORE_TIMEOUT_MS`
  // passed, so a source that pages to no visible change can't pin the
  // spinner forever.
  // The last settled result, for the click handler to snapshot — written in
  // an effect and read only in handlers/effects, never during render.
  const settled = useRef<{items: InboxItem[]; overflow: number | undefined}>({items: [], overflow: undefined})
  const sawLoading = useRef(false)
  // The rows standing in while a page loads, captured at click time. Its
  // presence *is* "a page is on its way".
  const [held, setHeld] = useState<{items: InboxItem[]; overflow: number | undefined} | null>(null)

  const loadingMore = held !== null
  const holding = held !== null && sourceLoading === true
  const shownItems = holding ? held.items : items
  const loading = holding ? false : sourceLoading

  useEffect(() => {
    if (!sourceLoading) settled.current = {items, overflow}
    if (!held) return
    if (sourceLoading) sawLoading.current = true
    else if (sawLoading.current || items !== held.items || overflow !== held.overflow) setHeld(null)
  }, [sourceLoading, items, overflow, held])

  useEffect(() => {
    if (!held) return undefined
    const timer = setTimeout(() => setHeld(null), LOAD_MORE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [held])

  // Stable, and always calls the source's *latest* `loadMore` — same
  // capability-ref reasoning as the rest below.
  const latestLoadMore = useRef(sourceLoadMore)
  const heldRef = useRef(held)
  useEffect(() => {
    latestLoadMore.current = sourceLoadMore
    heldRef.current = held
  })
  const loadMoreHeld = useCallback(() => {
    const call = latestLoadMore.current
    if (!call || heldRef.current) return
    sawLoading.current = false
    heldRef.current = settled.current
    setHeld(settled.current)
    call()
  }, [])
  const loadMore = sourceLoadMore ? loadMoreHeld : undefined

  const {open, cleared, snoozed} = useMemo(
    () => splitItems(shownItems, source.name, snoozes.state, now),
    [shownItems, source.name, snoozes.state, now],
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
  const capabilities = useRef<{[K in CapabilityKey]: InboxSourceResult[K]}>({
    loadMore,
    resolve,
    reopen,
    create,
    assess,
    proposeFix,
    assign,
    assigneeReadOnly,
    suggestSnooze,
    remove,
    update,
    openDetail,
    action,
    acknowledgable,
    transfer,
  })
  useEffect(() => {
    capabilities.current = {
      loadMore,
      resolve,
      reopen,
      create,
      assess,
      proposeFix,
      assign,
      assigneeReadOnly,
      suggestSnooze,
      remove,
      update,
      openDetail,
      action,
      acknowledgable,
      transfer,
    }
  })

  const hasLoadMore = Boolean(sourceLoadMore)
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
  const hasSuggestSnooze = Boolean(suggestSnooze)
  const isAcknowledgable = acknowledgable !== false
  const transferUserCount = transfer?.users.length ?? -1

  useEffect(() => {
    onReport(source.name, {
      source,
      loading,
      loadingMore,
      error,
      overflow,
      open,
      cleared,
      snoozed,
      ...capabilities.current,
    })
  }, [
    onReport,
    source,
    loading,
    loadingMore,
    error,
    overflow,
    open,
    cleared,
    snoozed,
    hasLoadMore,
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
    hasSuggestSnooze,
    isAcknowledgable,
    transferUserCount,
  ])

  return null
}
