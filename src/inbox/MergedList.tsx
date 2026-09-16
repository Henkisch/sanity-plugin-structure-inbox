import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {Badge, Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
import {type ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'
import {styled} from 'styled-components'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {resolveSnoozeUntil, type SnoozePreset} from '../store/snoozePresets'
import {type Assessments} from '../store/useAssessments'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {AskInbox} from './AskInbox'
import {CreateItemRow} from './CreateItemRow'
import {matchesInboxFilters} from './inboxFilterSentinels'
import {InboxRow} from './InboxRow'
import {mergeRows, type MergedRow} from './mergeItems'
import {SelectionActions} from './SelectionActions'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxView} from './types'
import {EXIT_ANIMATION_MS, useUndoToast} from './useUndoToast'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The checkbox/filter row and Ask, sharing one CSS Grid instead of two
 * stacked rows — narrow (mobile) keeps Ask on its own full-width row below
 * the checkbox cluster, exactly as before; wide screens fold it inline,
 * in the gap between the checkbox cluster and the filter/selection
 * cluster, cutting a whole row of chrome. Pure CSS: the same `AskInbox`
 * element just gets reassigned to a different named `grid-area` at the
 * container breakpoint, so there's no second instance to lose state (its
 * own typed question, in-flight answer) if the pane resizes mid-use — a
 * real risk the obvious alternative (render it twice, toggle visibility)
 * would have. `container-type: inline-size` lives on this row's own
 * `Card` (below), not a separate wrapper, since nested `@container`
 * scopes are fine and this row's own available width is what actually
 * decides whether Ask fits — not the viewport, and not the pane's own
 * two-column breakpoint (`Inbox.tsx`'s `ColumnsBoundary`), which answers
 * a different question (does the aside column fit at all).
 *
 * `640px` is a first estimate (roughly: checkbox cluster ~150px + a
 * usable Ask input ~250px + the filter/selection cluster's own widest
 * state), not a measured-live constant the way `minHeight: 54` below is —
 * revisit by eye if Ask ever looks cramped or the two side clusters ever
 * collide with it at a width just past this breakpoint.
 */
const HeaderGrid = styled.div<{$hasAsk: boolean}>`
  display: grid;
  align-items: center;
  column-gap: 12px;
  row-gap: 12px;
  grid-template-areas: ${(p) => (p.$hasAsk ? '"left right" "ask ask"' : '"left right"')};
  grid-template-columns: auto auto;
  justify-content: space-between;
  width: 100%;

  @container (min-width: 640px) {
    grid-template-areas: ${(p) => (p.$hasAsk ? '"left ask right"' : '"left right"')};
    grid-template-columns: ${(p) => (p.$hasAsk ? 'auto 1fr auto' : 'auto auto')};
  }
`

/** The one snooze duration "Snooze" actually applies — see `snoozeRows`'s own doc comment for why there's no picker. */
const SNOOZE_DEFAULT_PRESET: SnoozePreset = 'tomorrow'

interface MergedListProps {
  reports: Record<string, SourceReport>
  /** The sources array as configured — also the merge tiebreak, see `mergeRows`. */
  order: string[]
  view: InboxView
  dismissals: Dismissals
  snoozes: Snoozes
  /** Optional: a source-less test render (see `MergedList.test.tsx`) has no cache to read from. Real callers always pass one. */
  assessments?: Assessments
  /**
   * State owned by `Inbox.tsx` (it also needs it for the pane's own headline
   * count) — applied to `allRows` below. Multi-select: empty means "no
   * filter, show everything." See `ASSIGNEE_UNASSIGNED`.
   */
  assigneeFilter: ReadonlySet<string>
  typeFilter: ReadonlySet<string>
  /**
   * The actual filter controls (avatar stack + type menu), built in
   * `Inbox.tsx` from the same state as `assigneeFilter`/`typeFilter` above —
   * rendered here, in this column's own header, since they only ever
   * narrow this column and never the aside sources beside it.
   */
  filterBar?: ReactNode
  /** See `StructureInboxConfig.ask`'s own doc comment. Only ever shown in the Open view. */
  ask?: boolean
  /** See `StructureInboxConfig.context`'s own doc comment — passed straight through to `AskInbox`. */
  context?: string
  /**
   * Summarize / Suggest todos / a source's own `action` (Scan for issues) /
   * Add — every control that only ever affects this column, never the aside
   * beside it. Built in `Inbox.tsx` (the state they drive lives there), but
   * rendered inside this column's own header card rather than the pane-wide
   * header above both columns — that header spans the aside column too, so
   * a main-only control sitting in it read as scoped to the whole pane, and
   * left the aside column's own first card visually stranded just beneath
   * a row of buttons that had nothing to do with it.
   */
  actions?: ReactNode
  /**
   * Whatever `actions` above most recently produced — Summarize's message,
   * Suggest todos' items, a source's own `action` result, and so on. Built
   * in `Inbox.tsx` (same reasoning as `actions`), rendered here directly
   * beneath the toolbar rather than above this whole card: a click on a
   * button in `actions` used to produce a card that appeared *above* the
   * toolbar, checkbox row, and Ask input — backwards from where the editor
   * was just looking.
   */
  results?: ReactNode
  /**
   * Caps the list's own height, in pixels — typically the sidebar's actual
   * rendered height (`Inbox.tsx` measures it live), so this column never
   * grows taller than its neighbour. `undefined` before that measurement
   * exists yet (the very first render), in which case a fixed fallback is
   * used instead — see where this is read below. Only takes effect while
   * `scrollable` is true.
   */
  maxHeight?: number
  /**
   * Whether the list should be height-capped with its own inner
   * scrollbar at all — true whenever the sidebar it's capped against sits
   * beside it. Once `Inbox.tsx`'s `ResponsiveColumns` stacks the two
   * columns (narrow screens), the sidebar has already dropped below the
   * list, so a cap here just produced a second, redundant scrollbar
   * inside the page's own; passing `false` lets the list grow to its full
   * height instead.
   *
   * @defaultValue true
   */
  scrollable?: boolean
}

/**
 * The main column: every `main` source's items, for the current view, as one
 * sorted list — not one card per source.
 *
 * A source is still its own component upstream (`SourceFeed`, one per
 * source, each in its own error boundary), so a throwing source still costs
 * only its own rows; `errors` below is how that gets surfaced here instead of
 * as a full card of its own. What changed is what happens with the result:
 * everything is merged before it's drawn, so the editor sees one list to
 * clear, tagged by source on each row, rather than a stack of boxes to check
 * one at a time.
 */
export function MergedList(props: MergedListProps) {
  const {
    reports,
    order,
    view,
    dismissals,
    snoozes,
    assessments,
    assigneeFilter,
    typeFilter,
    filterBar,
    ask = false,
    context,
    maxHeight,
    scrollable = true,
    actions,
    results,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const allRows = useMemo(
    () => mergeRows(reports, order, view, dismissals.state),
    [reports, order, view, dismissals.state],
  )

  const rows = useMemo(
    () => allRows.filter((row) => matchesInboxFilters(row, assigneeFilter, typeFilter)),
    [allRows, assigneeFilter, typeFilter],
  )

  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [leavingKeys, setLeavingKeys] = useState<ReadonlySet<string>>(new Set())
  const showUndoToast = useUndoToast()

  // The row being edited, if any — a todo has nowhere else to send a click
  // when it has no `intent` to open, so it opens the same dialog `create`
  // uses instead, pre-filled. Keyed by row key rather than holding the row
  // itself so a stale reference can't outlive a refetch.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const editingRow = editingKey ? rows.find((row) => row.key === editingKey) : undefined

  // Derived from what's on screen, same reasoning every earlier version of
  // this list used: a row can disappear — someone else finishes it, the tab
  // changes — while selected, and deriving the selection from `rows` means
  // the action bar can never count one nobody can see.
  const selected = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.key)),
    [rows, selectedKeys],
  )

  const clearSelection = useCallback(() => setSelectedKeys([]), [])

  // Swaps in for the header's own filter bar, same slot — no separate row of
  // its own to ease open or shut, so this is a plain boolean, not a delayed
  // unmount: see the header `Flex` below for where it actually renders.
  const showSelectionBar = selected.length > 0
  // Only the count, not the whole `selected` array — `selected` is a fresh
  // array on some sources' every render regardless of real change (nothing
  // guarantees a source's own `items` is referentially stable), so comparing
  // it by identity here reliably looped instead of settling. `count` is a
  // primitive: comparing it can't loop, and it's the only thing this lingering
  // moment needs to avoid flashing "0 selected" while the bar shrinks shut.
  const [lastCount, setLastCount] = useState(selected.length)
  if (selected.length > 0 && selected.length !== lastCount) setLastCount(selected.length)
  const displayCount = selected.length > 0 ? selected.length : lastCount

  const allSelected = rows.length > 0 && selected.length === rows.length
  const someSelected = selected.length > 0 && !allSelected

  // Ticks or clears every row currently on screen — not the underlying
  // `selectedKeys`, which may still hold a key for a row that scrolled out of
  // this view (a different tab, say). Selecting all should only ever mean
  // "all of what I can see."
  const toggleAll = useCallback(() => {
    setSelectedKeys(allSelected ? [] : rows.map((row) => row.key))
  }, [allSelected, rows])

  // Shared between the bulk selection bar (`confirmSelection`, below) and a
  // single row's own three-dot menu — "mark done/clear" means the same thing
  // whether it's applied to a whole selection or to one row that was never
  // ticked at all.
  const resolveOrClearRows = useCallback(
    async (targets: MergedRow[]) => {
      // Both kinds of target actually leave Open now — a real resolve into a
      // source-confirmed Cleared, a manual clear into the same tab tagged
      // `clearedBy: 'editor'` (see `mergeItems.ts`'s own doc comment) — so
      // both get the same fade-then-remove treatment, not just the
      // resolvable ones.
      const resolvableTargets = targets.filter((row) => Boolean(reports[row.sourceName]?.resolve))
      // Excludes a source that opted out of `acknowledgable` (`todos`) — for
      // those rows there is nothing real for "confirm" to do, so a mixed
      // selection just silently skips them rather than clearing something
      // that has no in-between state to mark.
      const clearOnlyTargets = targets.filter((row) => {
        const report = reports[row.sourceName]
        return !report?.resolve && report?.acknowledgable !== false
      })
      const leavingTargets = [...resolvableTargets, ...clearOnlyTargets]

      if (leavingTargets.length > 0) {
        setLeavingKeys((current) => new Set([...current, ...leavingTargets.map((row) => row.key)]))
        await wait(EXIT_ANIMATION_MS)
      }

      setBusy(true)
      try {
        // Each row resolves through its own source's `resolve` — a mixed
        // selection is fine, `Promise.allSettled` means one item failing
        // never strands the rest.
        const results = await Promise.allSettled(
          resolvableTargets.map((row) => {
            const resolve = reports[row.sourceName]?.resolve
            return resolve ? resolve(row.item) : Promise.resolve()
          }),
        )

        let resolvedCount = 0
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            resolvedCount += 1
          } else {
            console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
          }
        })

        for (const row of clearOnlyTargets) dismissals.dismiss(row.sourceName, row.item.id)

        setLeavingKeys((current) => {
          const next = new Set(current)
          leavingTargets.forEach((row) => next.delete(row.key))
          return next
        })

        // A real resolve isn't reversible from here (the task actually
        // closed, say) — no undo offered for it, just a plain confirmation.
        // A manual clear is fully reversible (only local state changed), so
        // that one gets a real undo.
        if (resolvedCount > 0) {
          showUndoToast({title: t('undo.markedDone', {count: resolvedCount})})
        }
        if (clearOnlyTargets.length > 0) {
          showUndoToast({
            title: t('undo.cleared', {count: clearOnlyTargets.length}),
            onUndo: () =>
              clearOnlyTargets.forEach((row) => dismissals.restore(row.sourceName, row.item.id)),
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [reports, dismissals, showUndoToast, t],
  )

  // Shared between the bulk bar's "Mark as not done" and a single row's own
  // menu — puts each target back in Open, through whichever route actually
  // got it into Cleared in the first place: a real, source-confirmed row
  // (`row.clearedBy === 'source'`) reopens through its own source's `reopen`
  // (the only thing that can undo real Sanity state); a manually-cleared row
  // (`row.clearedBy === 'editor'`) has no such state to undo at all — it was
  // only ever a dismissal, so restoring that dismissal is the whole of
  // "reopening" it. A real row with no `reopen` is silently skipped rather
  // than erroring: that shouldn't happen today (only `openTasks` ever
  // produces a real `clearedBy: 'source'` row, and it always offers
  // `reopen`), but a future Cleared-producing source that forgot to
  // implement it shouldn't crash this instead of just not undoing.
  const reopenRows = useCallback(
    async (targets: MergedRow[]) => {
      const realTargets = targets.filter((row) => row.clearedBy !== 'editor')
      const manualTargets = targets.filter((row) => row.clearedBy === 'editor')

      setBusy(true)
      try {
        const results = await Promise.allSettled(
          realTargets.map((row) => {
            const reopen = reports[row.sourceName]?.reopen
            return reopen ? reopen(row.item) : Promise.resolve()
          }),
        )

        let reopenedCount = 0
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            reopenedCount += 1
          } else {
            console.error('[sanity-plugin-structure-inbox] could not reopen item', result.reason)
          }
        })

        for (const row of manualTargets) dismissals.restore(row.sourceName, row.item.id)

        // A real, undone resolution — same as "Mark as done" itself, no
        // undo offered here either: the task really reopened. Restoring a
        // manual clear is the same "just local state" case dismissing it
        // was — but this action already *is* the undo of that clear, so
        // offering a second undo on top of it would be undoing an undo.
        if (reopenedCount > 0) {
          showUndoToast({title: t('undo.markedNotDone', {count: reopenedCount})})
        }
      } finally {
        setBusy(false)
      }
    },
    [reports, dismissals, showUndoToast, t],
  )

  const confirmSelection = useCallback(async () => {
    if (view === 'cleared') {
      const targets = [...selected]
      setSelectedKeys([])
      await reopenRows(targets)
      return
    }

    if (view === 'snoozed') {
      for (const row of selected) snoozes.wake(row.sourceName, row.item.id)
      setSelectedKeys([])
      return
    }

    const targets = [...selected]
    // Cleared immediately — the bar disappearing is the confirmation the
    // click landed; the resolvable rows themselves fade a beat longer
    // before the mutation that actually removes them runs, see
    // `resolveOrClearRows`'s own `EXIT_ANIMATION_MS` wait.
    setSelectedKeys([])
    await resolveOrClearRows(targets)
  }, [view, selected, snoozes, resolveOrClearRows, reopenRows])

  // Shared the same way `resolveOrClearRows` is — the bulk bar's own
  // `confirmSnooze` and a single row's menu both snooze through this.
  //
  // One click, one default — not a picker. An earlier version offered three
  // presets (later today/tomorrow/next week) behind a native `<select>`,
  // which turned "not now" into its own small decision instead of a single
  // click. `SNOOZE_DEFAULT_PRESET` is that one default; see
  // `store/snoozePresets.ts` if a real need for more than one ever comes up.
  const snoozeRows = useCallback(
    (targets: MergedRow[], until: string) => {
      setLeavingKeys((current) => new Set([...current, ...targets.map((row) => row.key)]))

      setTimeout(() => {
        for (const row of targets) {
          snoozes.snooze(row.sourceName, row.item.id, until)
          // Snoozing is also seeing it — same dismissal `action.clear` sets
          // in Open, so the item doesn't read as newly-unseen the moment it
          // wakes back into Open. This one never routes it into Cleared,
          // though (see `mergeItems.ts`'s own `mergeRows`): only an item
          // still in the Open bucket gets that treatment, and a snoozed item
          // never is.
          dismissals.dismiss(row.sourceName, row.item.id)
        }

        setLeavingKeys((current) => {
          const next = new Set(current)
          targets.forEach((row) => next.delete(row.key))
          return next
        })

        showUndoToast({
          title: t('undo.snoozed', {count: targets.length}),
          onUndo: () =>
            targets.forEach((row) => {
              snoozes.wake(row.sourceName, row.item.id)
              dismissals.restore(row.sourceName, row.item.id)
            }),
        })
      }, EXIT_ANIMATION_MS)
    },
    [snoozes, dismissals, showUndoToast, t],
  )

  /** Snoozing is a plugin-level capability, not a per-source one — every item can be, regardless of where it came from. */
  const confirmSnooze = useCallback(() => {
    const targets = [...selected]
    setSelectedKeys([])
    snoozeRows(targets, resolveSnoozeUntil(SNOOZE_DEFAULT_PRESET))
  }, [selected, snoozeRows])

  /**
   * The other half of the snooze control: an AI-suggested instant, read out
   * of the selected item's own content (see `suggestSnoozeState` below and
   * `InboxSourceResult.suggestSnooze`'s own doc comment) rather than the
   * fixed default preset. Shares every bit of `snoozeRows`'s own
   * choreography — only the instant differs.
   */
  const confirmSnoozeUntil = useCallback(
    (until: string) => {
      const targets = [...selected]
      setSelectedKeys([])
      snoozeRows(targets, until)
    },
    [selected, snoozeRows],
  )

  // Only the rows whose own source actually offers `remove` — a mixed
  // selection just deletes what it can, same reasoning `resolveOrClearRows`
  // already uses for a mixed resolve/clear batch. Real removal, not a
  // soft dismiss, so — same as the row-level "Delete" this replaces — no
  // undo is offered.
  const deletableTargets = selected.filter((row) => Boolean(reports[row.sourceName]?.remove))

  const confirmDelete = useCallback(async () => {
    const targets = deletableTargets
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((row) => Promise.resolve(reports[row.sourceName]?.remove?.(row.item))),
      )
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('[sanity-plugin-structure-inbox] could not delete item', result.reason)
        }
      })
      setSelectedKeys([])
    } finally {
      setBusy(false)
    }
  }, [deletableTargets, reports])

  // Only offered when every selected row shares one source, and that source
  // actually offers `assign`: assigning across sources with different
  // assignee pools has no single well-defined meaning.
  const assignableSource =
    selected.length > 0 && selected.every((row) => row.sourceName === selected[0].sourceName)
      ? reports[selected[0].sourceName]?.assign
      : undefined

  const confirmAssign = useCallback(
    async (userId: string) => {
      if (!assignableSource) return
      const targets = [...selected]
      const assignee = assignableSource.users.find((user) => user.id === userId)?.label ?? userId

      setBusy(true)
      try {
        const results = await Promise.allSettled(
          targets.map((row) => assignableSource.toUser(row.item, userId)),
        )

        let assignedCount = 0
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[sanity-plugin-structure-inbox] could not assign item', result.reason)
          } else {
            assignedCount += 1
          }
        })

        setSelectedKeys([])

        // Assigning creates a new Task rather than changing the row that was
        // selected, so nothing in the list itself said the click landed —
        // this is the only confirmation there is.
        if (assignedCount > 0) {
          showUndoToast({title: t('undo.assigned', {count: assignedCount, name: assignee})})
        }
      } finally {
        setBusy(false)
      }
    },
    [assignableSource, selected, showUndoToast, t],
  )

  // A suggestion only ever makes sense for exactly one selected row (see
  // `InboxSourceResult.suggestSnooze`'s own doc comment: a single date for a
  // mixed selection is either wrong for most of them or an average of
  // unrelated things) and only in the Open view — a cleared or snoozed row
  // has nothing to snooze *to* yet.
  const singleSelectedRow = view === 'open' && selected.length === 1 ? selected[0] : undefined
  const suggestSnoozeForRow = singleSelectedRow
    ? reports[singleSelectedRow.sourceName]?.suggestSnooze
    : undefined

  const [snoozeSuggestion, setSnoozeSuggestion] = useState<{until: string; reason?: string} | null>(null)

  useEffect(() => {
    if (!singleSelectedRow || !suggestSnoozeForRow) {
      setSnoozeSuggestion(null)
      return undefined
    }

    let cancelled = false
    setSnoozeSuggestion(null)

    suggestSnoozeForRow(singleSelectedRow.item)
      .then((result) => {
        if (!cancelled) setSnoozeSuggestion(result)
        return undefined
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('[sanity-plugin-structure-inbox] suggest-snooze failed', error)
        }
      })

    return () => {
      cancelled = true
    }
    // Keyed on the row's own key, not the row object itself — a fresh report
    // re-render can hand back a same-shaped-but-new row object for the exact
    // same selection, which would otherwise re-ask on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above; `singleSelectedRow`/`suggestSnoozeForRow` are intentionally read fresh from the closure, not tracked.
  }, [singleSelectedRow?.key])

  // Same gate as the snooze suggestion above (exactly one selected row, Open
  // view only) — `assignableSource` already requires every selected row to
  // share one source, trivially true for exactly one.
  const suggestAssigneeForRow = singleSelectedRow ? assignableSource?.suggestAssignee : undefined

  const [assigneeSuggestion, setAssigneeSuggestion] = useState<{
    userId: string
    reason: 'lastEditor'
  } | null>(null)

  useEffect(() => {
    if (!singleSelectedRow || !suggestAssigneeForRow) {
      setAssigneeSuggestion(null)
      return undefined
    }

    let cancelled = false
    setAssigneeSuggestion(null)

    suggestAssigneeForRow(singleSelectedRow.item)
      .then((result) => {
        if (!cancelled) setAssigneeSuggestion(result)
        return undefined
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('[sanity-plugin-structure-inbox] suggest-assignee failed', error)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same reasoning as the snooze-suggestion effect above; `singleSelectedRow`/`suggestAssigneeForRow` are intentionally read fresh from the closure, not tracked.
  }, [singleSelectedRow?.key])

  const reportsInOrder = order
    .map((name) => reports[name])
    .filter((r): r is SourceReport => Boolean(r))
  // `update` too, not just `create`: the same dialog hosts both, and a
  // source could in principle offer editing without offering creation.
  const creators = reportsInOrder.filter((r) => r.create || r.update)
  const errors = reportsInOrder.filter((r) => r.error)

  // A configured source that has not reported at all yet counts as loading,
  // the same as one that has reported `loading: true` — otherwise the first
  // render, before any `SourceFeed` effect has fired, flashes "All clear."
  const anyLoading = order.some((name) => !reports[name] || reports[name]?.loading)
  const isEmpty = rows.length === 0

  const describeSource = useCallback(
    (report: SourceReport | undefined, item: InboxItem): string | undefined => {
      if (!report) return undefined
      // An item's own `category` (when a source's items aren't all the same
      // kind — see its own doc comment) wins over the source's static title.
      const category = item.category ?? report.source.title
      // The avatar chip already shows a face, but not a name at this size —
      // naming the assignee here is the only place on the row that actually
      // spells it out.
      if (item.assignee) return `${category} · ${item.assignee.label}`
      // An item nobody has picked up yet, from a source that actually offers
      // `assign`, already shows the faint placeholder avatar
      // (`InboxRow.tsx`) — "Unassigned" here names that placeholder instead
      // of restating the source's audience, which said nothing about whether
      // this particular item has anyone on it. A source with no `assign` at
      // all (a release, a todo) was never individually assignable, so its
      // audience is still the only true thing to say about it.
      if (report.assign) return `${category} · ${t('assignee.unassigned')}`
      // A `visibility: 'private'` source's own "Only you" section header
      // (`MergedList.tsx`'s `GroupHeader`) already says this once — repeating
      // it here as "Assigned to you" restated the wrong claim besides (a
      // todo was never assigned, it's just yours) on every single row under
      // it.
      if (report.source.visibility === 'private') return category
      const audience =
        report.source.audience === 'mine' ? t('audience.mine') : t('audience.everyone')
      return `${category} · ${audience}`
    },
    [t],
  )

  // The three-dot menu's contents for one row — the same actions the bulk
  // selection bar offers this view, applied to just this row, without
  // ticking its checkbox first.
  const buildMenuActions = useCallback(
    (row: MergedRow, report: SourceReport | undefined) => {
      // Reachable from every view, same as the bulk bar's own inline "Delete"
      // (`InboxRow.tsx`'s `removeRow`) — that one only ever showed once a row
      // was the sole selection; this is the same capability, just without
      // needing to select first, matching every other per-row menu action.
      const deleteEntry = report?.remove
        ? [
            {
              key: 'delete',
              label: t('action.delete'),
              onClick: () => report.remove?.(row.item),
              tone: 'critical' as const,
            },
          ]
        : []

      if (view === 'cleared') {
        return [
          {
            key: 'reopen',
            label: t('action.markNotDone'),
            onClick: () => {
              reopenRows([row]).catch((error: unknown) => {
                console.error('[sanity-plugin-structure-inbox] could not reopen item', error)
              })
            },
          },
          ...deleteEntry,
        ]
      }

      if (view === 'snoozed') {
        return [
          {
            key: 'wake',
            label: t('action.wakeNow'),
            onClick: () => snoozes.wake(row.sourceName, row.item.id),
          },
          ...deleteEntry,
        ]
      }

      // A row reaches this menu (the Open view's own) only while it's still
      // genuinely open — a dismissed-and-fresh row is routed straight into
      // Cleared by `mergeItems.ts`'s own `mergeRows`, so there's no "already
      // cleared, offer to un-clear it" case to handle here at all; that only
      // ever happens from within the Cleared view's own menu, above.
      //
      // A source with neither `resolve` nor `acknowledgable` (`todos`) has
      // nothing real for "confirm" to do — omitted entirely rather than
      // offered as a control that would just silently do nothing.
      const canConfirm = Boolean(report?.resolve) || report?.acknowledgable !== false

      return [
        ...(canConfirm
          ? [
              {
                key: 'confirm',
                label: report?.resolve ? t('action.markDone') : t('action.clear'),
                onClick: () => {
                  resolveOrClearRows([row]).catch((error: unknown) => {
                    console.error('[sanity-plugin-structure-inbox] could not resolve item', error)
                  })
                },
              },
            ]
          : []),
        {
          key: 'snooze',
          label: t('action.snooze'),
          onClick: () => snoozeRows([row], resolveSnoozeUntil(SNOOZE_DEFAULT_PRESET)),
        },
        ...deleteEntry,
      ]
    },
    [view, snoozes, resolveOrClearRows, snoozeRows, reopenRows, t],
  )

  // Splits the already-sorted `rows` into Team/Private-to-you, preserving
  // each row's relative order — see `InboxSource.visibility`'s own doc
  // comment for the axis this groups on, and why it isn't `audience`. Only
  // ever shown once both groups actually have something in them: one group
  // alone is just today's flat list, not a split worth labeling.
  const {sharedRows, privateRows} = useMemo(() => {
    const shared: MergedRow[] = []
    const priv: MergedRow[] = []
    for (const row of rows) {
      if (reports[row.sourceName]?.source.visibility === 'private') priv.push(row)
      else shared.push(row)
    }
    return {sharedRows: shared, privateRows: priv}
  }, [rows, reports])
  const showGroupHeaders = sharedRows.length > 0 && privateRows.length > 0

  const renderRow = (row: MergedRow) => {
    const report = reports[row.sourceName]
    // Only in the Cleared view: says outright whether Sanity itself
    // confirmed this is done, or an editor just called it done themselves —
    // see `mergeItems.ts`'s own doc comment on `clearedBy` for why that
    // distinction stays visible instead of the two kinds of "cleared"
    // silently looking identical.
    const clearedLabel =
      view === 'cleared'
        ? row.clearedBy === 'editor'
          ? t('cleared.manual')
          : t('cleared.confirmed')
        : undefined
    const baseLabel = describeSource(report, row.item)
    const sourceLabel = [baseLabel, clearedLabel].filter(Boolean).join(' · ') || undefined
    // A cache hit seeds the row's own state directly (see `InboxRow`'s
    // `initialAssessment`), so it renders instantly with no click at all —
    // and a wrapped `onAssess`, not the source's own, so a live result gets
    // cached the moment it comes back. Neither depends on the source's own
    // `assess` existing: both are simply absent when it doesn't.
    const initialAssessment = report?.assess
      ? (assessments?.read(row.sourceName, row.item.id, row.item.changedAt) ?? undefined)
      : undefined
    const onAssess = report?.assess
      ? async (item: InboxItem) => {
          const assessment = await report.assess!(item)
          assessments?.write(row.sourceName, item.id, assessment, item.changedAt)
          return assessment
        }
      : undefined
    return (
      <InboxRow
        assigneeReadOnly={report?.assigneeReadOnly}
        assignableUsers={report?.assign?.users}
        done={view === 'cleared'}
        initialAssessment={initialAssessment}
        item={row.item}
        key={row.key}
        leaving={leavingKeys.has(row.key)}
        menuActions={buildMenuActions(row, report)}
        onAssess={onAssess}
        onProposeFix={report?.proposeFix}
        onEdit={
          report?.update
            ? () => setEditingKey(row.key)
            : report?.openDetail
              ? () => report.openDetail?.(row.item)
              : undefined
        }
        onReassign={
          report?.assign
            ? (item, userId) => {
                const assign = report.assign
                if (!assign) return
                const assignee = assign.users.find((u) => u.id === userId)?.label ?? userId
                assign
                  .toUser(item, userId)
                  .then(() =>
                    showUndoToast({
                      title: t('undo.assigned', {count: 1, name: assignee}),
                    }),
                  )
                  .catch((error: unknown) => {
                    console.error('[sanity-plugin-structure-inbox] could not assign item', error)
                  })
              }
            : undefined
        }
        onUnassign={
          report?.assign?.unassign
            ? (item) => {
                const unassign = report.assign?.unassign
                if (!unassign) return
                unassign(item)
                  .then(() => showUndoToast({title: t('undo.unassigned')}))
                  .catch((error: unknown) => {
                    console.error('[sanity-plugin-structure-inbox] could not unassign item', error)
                  })
              }
            : undefined
        }
        onSelectedChange={(item: InboxItem, isSelected: boolean) =>
          setSelectedKeys((current) =>
            isSelected ? [...current, row.key] : current.filter((existing) => existing !== row.key),
          )
        }
        selected={selectedKeys.includes(row.key)}
        sourceLabel={sourceLabel}
      />
    )
  }

  return (
    <Stack gap={3}>
      {errors.map((report) => (
        <Card key={report.source.name} padding={3} radius={2} tone="critical">
          <Text size={1}>
            {report.source.title}: {report.error?.message ?? t('source.error.title')}
          </Text>
        </Card>
      ))}

      {/* The "add new" trigger now lives in `Inbox.tsx`'s tab row instead —
          this instance is edit-only, mounted only while an item from an
          editable source is actually being edited. `hideTrigger` keeps it
          from also drawing a second, redundant "+ Add todo" button here
          even in that brief window. */}
      {view === 'open' &&
        editingRow &&
        creators
          .filter((report) => report.source.name === editingRow.sourceName)
          .map((report) => (
            <CreateItemRow
              editing={{
                key: editingRow.key,
                title: editingRow.item.title,
                description: editingRow.item.description,
                dueBy: editingRow.item.dueBy,
                onSave: (input) => {
                  Promise.resolve(report.update?.(editingRow.item, input)).catch(
                    (error: unknown) => {
                      console.error('[sanity-plugin-structure-inbox] could not update item', error)
                    },
                  )
                  setEditingKey(null)
                },
                onCancel: () => setEditingKey(null),
              }}
              hideTrigger
              key={report.source.name}
              onCreate={(input) => report.create?.(input)}
            />
          ))}

      <Card border overflow="hidden" radius={3} shadow={0}>
        {/* This column's own toolbar — see `actions`' own doc comment for
            why these live here now rather than in `Inbox.tsx`'s pane-wide
            header. Its own row, above the checkbox/filter row below: that
            row's `minHeight` is already tuned against the filter bar and
            selection bar it swaps between, and squeezing a variable-width
            button cluster into the same row would have broken that.
            `inbox.title` on the left fills what used to be dead space —
            `Inbox.tsx`'s own component pane deliberately has no title bar
            of its own any more (see `inboxComponent`'s doc comment), so
            this is now the one place in the pane that actually names it. */}
        {actions && (
          <Card borderBottom paddingX={3} paddingY={3} radius={0} tone="transparent">
            <Flex align="center" gap={2} justify="space-between" wrap="wrap">
              <Text muted size={1} weight="semibold">
                {t('inbox.title')}
              </Text>
              <Flex gap={2} wrap="wrap">
                {actions}
              </Flex>
            </Flex>
          </Card>
        )}
        {/* Directly below the toolbar that produced it — see `results`'
            own doc comment for why. Each individual card (`Inbox.tsx`)
            already carries its own `marginBottom`/padding; this wrapper
            only supplies the horizontal inset so a card doesn't sit flush
            against this outer Card's own rounded border. */}
        {results && (
          <Box paddingTop={3} paddingX={3}>
            {results}
          </Box>
        )}
        {/* Matches the header every `aside` source's own card already has
            (`SectionCard`) — the main column merges every source into one
            list, but it's still one section, and it looked like an
            afterthought without a header of its own to say so. `minHeight`
            (measured live: the filter bar's own row rendered at 54px, the
            selection bar's at 50px) is a floor, not a fixed height — Ask's
            own row (narrow) or its own answer text (either width) can still
            grow this taller. No `tone="transparent"` (unlike the actions
            toolbar above) — this row selects/filters the exact rows below
            it, tied to the list the same way `results`/Ask are, so it gets
            the list's own plain background instead of the toolbar's boxed
            one; only the toolbar is generic enough to earn that distinct
            "header" treatment. `container-type: inline-size` here (not a
            separate wrapper) is what `HeaderGrid`'s own `@container` query
            measures against — see its doc comment for why this row's own
            width, not the viewport or the pane's two-column breakpoint. */}
        <Card
          borderBottom
          paddingX={3}
          paddingY={3}
          radius={0}
          style={{containerType: 'inline-size', minHeight: 54}}
        >
          <HeaderGrid $hasAsk={ask && view === 'open'}>
            {/* Extra `paddingLeft={1}` beyond the Card's own `padding={3}` —
                matches `InboxRow.tsx`'s own checkbox wrapper exactly (also
                `paddingLeft={1}`), confirmed live: without it this header's
                checkbox sat 4px right of every row's own, the one step's
                difference between the two paddings. */}
            {/* Replaces the icon+"Inbox" label this header used to open
                with — that text was purely decorative (the left nav's own
                "Inbox" item, and the pane's own heading above this card,
                already say it), while the select-all checkbox is a real
                control that deserves the header's own prominent spot more
                than a repeated label does. */}
            <Flex align="center" gap={1} paddingLeft={1} style={{gridArea: 'left'}}>
              <Tooltip
                content={
                  <Box padding={2}>
                    <Text size={1}>{t('selection.selectAll')}</Text>
                  </Box>
                }
                placement="bottom"
              >
                <Checkbox
                  aria-label={t('selection.selectAll')}
                  checked={allSelected}
                  disabled={isEmpty}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </Tooltip>

              {/* The caret Gmail's own select-all checkbox always carries
                  beside it — without one this was just a bare checkbox
                  with nothing else in reach. `All`/`None` repeat the same
                  toggle the checkbox itself already does (a mouse-only
                  equivalent, for anyone who reaches for the menu first);
                  `Team`/`Only you` — only once the list actually has both
                  groups, the same condition `showGroupHeaders` below
                  renders on — is the one selection here the checkbox alone
                  can't make: everyone's business in one click, or just
                  your own. */}
              <MenuButton
                button={
                  <Button
                    aria-label={t('selection.selectMenu')}
                    disabled={isEmpty}
                    icon={ChevronDownIcon}
                    mode="bleed"
                    padding={2}
                  />
                }
                id="merged-list-select-menu"
                menu={
                  <Menu>
                    <MenuItem
                      onClick={() => setSelectedKeys(rows.map((row) => row.key))}
                      text={t('selection.all')}
                    />
                    <MenuItem onClick={() => setSelectedKeys([])} text={t('selection.none')} />
                    {showGroupHeaders && (
                      <>
                        <MenuDivider />
                        <MenuItem
                          onClick={() => setSelectedKeys(sharedRows.map((row) => row.key))}
                          text={t('inbox.section.shared')}
                        />
                        <MenuItem
                          onClick={() => setSelectedKeys(privateRows.map((row) => row.key))}
                          text={t('inbox.section.private')}
                        />
                      </>
                    )}
                  </Menu>
                }
                popover={{placement: 'bottom-start', portal: true}}
              />

              {/* Lives here, next to the menu that controls it, rather
                  than inside `SelectionActions` itself — that keeps this
                  left-hand cluster (checkbox, menu, count) and the actions
                  on the right (`SelectionActions`) each their own group,
                  flush to opposite ends of the header instead of bunched
                  together on one side. */}
              {showSelectionBar && (
                <Box aria-live="polite" paddingLeft={2}>
                  <Text size={1} weight="medium">
                    {t('selection.count', {count: displayCount})}
                  </Text>
                </Box>
              )}
            </Flex>

            {/* Only in the Open view — asking "what can I ignore" of the
                Done tab has no meaning, and the Snoozed tab's rows are
                already deferred. Its only effect is `setSelectedKeys`: see
                `AskInbox`'s own doc comment for why that is the whole
                safety argument for this feature — a selection it makes
                flips the `left` cluster above/beside it into showing a
                count, and the `right` cluster into `SelectionActions`, the
                same feedback a manual tick already gives. */}
            {/* Capped, not stretched to fill the whole flexible middle
                track — a single-line question input spanning the entire
                gap between the two side clusters reads as an oversized
                empty box, not an intentional width. */}
            {ask && view === 'open' && (
              <Box style={{gridArea: 'ask', maxWidth: 480}}>
                <AskInbox context={context} onSelect={setSelectedKeys} rows={rows} />
              </Box>
            )}

            <Box style={{gridArea: 'right'}}>
              {showSelectionBar ? (
                <SelectionActions
                  assigneeSuggestion={view === 'open' ? (assigneeSuggestion ?? undefined) : undefined}
                  assignableUsers={view === 'open' ? assignableSource?.users : undefined}
                  busy={busy}
                  count={displayCount}
                  onAssign={view === 'open' && assignableSource ? confirmAssign : undefined}
                  onCancel={clearSelection}
                  onConfirm={confirmSelection}
                  onDelete={deletableTargets.length > 0 ? confirmDelete : undefined}
                  onSnooze={view === 'open' ? confirmSnooze : undefined}
                  onSnoozeUntil={view === 'open' ? confirmSnoozeUntil : undefined}
                  snoozeSuggestion={view === 'open' ? (snoozeSuggestion ?? undefined) : undefined}
                  resolvableCount={
                    selected.filter((row) => Boolean(reports[row.sourceName]?.resolve)).length
                  }
                  showConfirm={
                    view !== 'open' ||
                    selected.some((row) => {
                      const report = reports[row.sourceName]
                      return Boolean(report?.resolve) || report?.acknowledgable !== false
                    })
                  }
                  view={view}
                />
              ) : (
                filterBar
              )}
            </Box>
          </HeaderGrid>
        </Card>

        {anyLoading && isEmpty ? (
          <Box padding={3}>
            <Text muted size={1}>
              {t('source.loading')}
            </Text>
          </Box>
        ) : isEmpty ? (
          <Box padding={3}>
            <Text muted size={1}>
              {view === 'cleared'
                ? t('source.noneCleared')
                : view === 'snoozed'
                  ? t('source.noneSnoozed')
                  : t('source.empty')}
            </Text>
          </Box>
        ) : (
          <Stack>
            {/* Capped, not left to grow with however many rows are open —
                the persistent sidebar next to this column has its own
                (roughly stable) height, and an Inbox list that could grow
                taller than it forever made that neighbour look like an
                afterthought. `maxHeight` is the sidebar's own live rendered
                height (`Inbox.tsx` measures it with a `ResizeObserver`);
                `560` (~9 rows) is only a placeholder for the one render
                before that measurement exists. Only while `scrollable`,
                though — once the columns stack (see that prop's own doc
                comment), there is no neighbour to match height with, and
                capping it here just gave the list a second, inner
                scrollbar on top of the page's own. */}
            <Box
              style={
                scrollable ? {maxHeight: maxHeight ?? 560, overflowY: 'auto'} : undefined
              }
            >
              <Stack gap={1} padding={1}>
                {showGroupHeaders ? (
                  <>
                    <GroupHeader count={sharedRows.length} label={t('inbox.section.shared')} />
                    {sharedRows.map(renderRow)}
                    <GroupHeader count={privateRows.length} label={t('inbox.section.private')} />
                    {privateRows.map(renderRow)}
                  </>
                ) : (
                  rows.map(renderRow)
                )}
              </Stack>
            </Box>
          </Stack>
        )}
      </Card>
    </Stack>
  )
}

/**
 * The divider between the Team and Private-to-you groups (see
 * `InboxSource.visibility`) — a plain header row, not another `SectionCard`:
 * this list is still one card, just visually split, not two separate ones.
 */
function GroupHeader(props: {label: string; count: number}) {
  return (
    <Box paddingBottom={2} paddingTop={2} paddingX={2}>
      <Flex align="center" gap={2}>
        <Text muted size={0} weight="semibold">
          {props.label}
        </Text>
        {/* Same rounded-pill treatment the type-filter's own active count
            already uses (`Inbox.tsx`'s filter `Badge`) — a plain muted
            number here read as part of the label's own sentence, not as a
            count of something. */}
        <Badge fontSize={0} padding={1} radius="full">
          {props.count}
        </Badge>
      </Flex>
    </Box>
  )
}
