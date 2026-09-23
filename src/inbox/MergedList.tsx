import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'sanity'
import {styled} from 'styled-components'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {resolveSnoozeUntil, type SnoozePreset} from '../store/snoozePresets'
import {type Assessments} from '../store/useAssessments'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {CountBadge} from '../ui/CountBadge'
import {AskInbox, type AskState} from './AskInbox'
import {CreateItemRow} from './CreateItemRow'
import {matchesInboxFilters} from './inboxFilterSentinels'
import {InboxRow} from './InboxRow'
import {mergeRows, type MergedRow} from './mergeItems'
import {RowBoundary} from './RowBoundary'
import {type ContentTypeSummary} from './projectDigest'
import {
  SelectionActions,
  type AssigneeSuggestionState,
  type SnoozeSuggestionState,
} from './SelectionActions'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxView} from './types'
import {useAiRead} from './useAiRead'
import {EXIT_ANIMATION_MS, useUndoToast} from './useUndoToast'
import {mapWithConcurrency} from './concurrency'

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
/** Patches in flight at once during a bulk quick fix — same reasoning as the project survey's own bound: a two-hundred-row selection is exactly where an unbounded burst stops being theoretical. */
const QUICK_FIX_CONCURRENCY = 5

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
  /** Same convention; optional, since only a Studio with document-level translation ever sets it. */
  languageFilter?: ReadonlySet<string>
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
  /** Passed straight through to `AskInbox` — see that component's own `getProjectDigest` doc comment. */
  getProjectDigest?: () => Promise<ContentTypeSummary[]>
  /**
   * `AskInbox`'s own answer, owned by `Inbox.tsx` (same reasoning as
   * `actions`/`results` below) so it can render as another dismissible
   * card in `mainColumnResults` instead of squeezed into this row's own
   * header — see `AskInbox`'s own `result` prop doc comment. Optional
   * (defaults to idle/a no-op setter) the same way `ask` itself is —
   * only meaningful while `ask` is actually on.
   */
  askResult?: AskState
  onAskResultChange?: (state: AskState) => void
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
  /**
   * Bumps that source's shared reset counter (`SharedInboxStore.retrySource`
   * in `inboxCountLayout.tsx`) when the editor clicks "Try again" on one of
   * `errors` below. `Inbox.tsx` passes this straight through from
   * `useSharedInboxStore()` and also feeds the same counter into
   * `BoundedSourceFeed`'s `resetKey` — one click remounts both this pane's
   * feed for that source and, if it's mounted, the always-mounted count
   * provider's own feed for it. Optional only for `MergedList.test.tsx`'s
   * source-less renders; a real caller always passes one.
   */
  onRetrySource?: (sourceName: string) => void
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
    languageFilter,
    filterBar,
    ask = false,
    context,
    getProjectDigest,
    askResult = {status: 'idle'},
    onAskResultChange = () => {},
    maxHeight,
    scrollable = true,
    actions,
    results,
    onRetrySource,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const allRows = useMemo(
    () => mergeRows(reports, order, view, dismissals.state),
    [reports, order, view, dismissals.state],
  )

  const rows = useMemo(
    () => allRows.filter((row) => matchesInboxFilters(row, assigneeFilter, typeFilter, languageFilter)),
    [allRows, assigneeFilter, typeFilter, languageFilter],
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

  // Only the rows that promised a free, instant answer — `quickFixable`, not
  // merely `fixable`. A model-backed proposal bills per row, so a selection
  // bar that took those too would turn one click into one charge per
  // selected row, which is exactly the thing an editor can't see coming.
  const quickFixableTargets = selected.filter(
    (row) => row.item.quickFixable && Boolean(reports[row.sourceName]?.proposeFix),
  )

  // Rows that can be fixed, but not for free. Counted rather than acted on:
  // they stay on screen, and the toast says so, because silently leaving
  // them out reads as the action having half-failed.
  const needsReviewCount = selected.filter(
    (row) => !row.item.quickFixable && row.item.fixable && Boolean(reports[row.sourceName]?.proposeFix),
  ).length

  // A single-row fix confirms itself here rather than on the row, because the
  // row is usually gone by the time anyone reads it. No undo: this is a real
  // write to a shared document, the same line `resolveOrClearRows` already
  // draws between that and this pane's own local state.
  const handleFixApplied = useCallback(
    (_item: InboxItem, summary: string) => {
      showUndoToast({title: summary})
    },
    [showUndoToast],
  )

  // `busy` drives the disabled state; this ref is what actually closes the
  // race. Two clicks landing in the same React batch both read the
  // pre-commit `busy === false`, so a state check alone lets both run the
  // whole batch — which for this action means every selected row's fix
  // applied twice, to real shared documents. See `useAiRead.ts`'s own
  // doc comment for the general in-flight-ref-vs-state reasoning.
  const quickFixInFlightRef = useRef(false)

  const confirmQuickFix = useCallback(async () => {
    if (quickFixInFlightRef.current) return
    quickFixInFlightRef.current = true
    const targets = quickFixableTargets
    setBusy(true)
    try {
      // Each item settles inside its own callback rather than letting one
      // rejection abort the batch — nineteen good fixes should not be lost to
      // the twentieth document being locked.
      const results = await mapWithConcurrency(targets, QUICK_FIX_CONCURRENCY, async (row) => {
        try {
          const proposal = await reports[row.sourceName]?.proposeFix?.(row.item, {instantOnly: true})
          // No proposal is a success, not a failure: the likeliest reason is
          // that someone filled this in by hand between the query and the
          // click, which is the outcome this action wanted anyway.
          if (!proposal) return false
          await proposal.apply()
          return true
        } catch (error) {
          console.error('[sanity-plugin-structure-inbox] could not fix item', error)
          return false
        }
      })

      const fixed = results.filter(Boolean).length

      setSelectedKeys([])

      // No undo. These are real writes to documents the whole team shares,
      // not this pane's own local state — the same line `resolveOrClearRows`
      // already draws between the two.
      const parts = [t('fix.bulkDone', {count: fixed})]
      if (needsReviewCount > 0) parts.push(t('fix.bulkSkipped', {count: needsReviewCount}))
      showUndoToast({title: parts.join(' · ')})
    } finally {
      quickFixInFlightRef.current = false
      setBusy(false)
    }
  }, [needsReviewCount, quickFixableTargets, reports, showUndoToast, t])

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

        // Assigning writes a bookkeeping record rather than changing the
        // row that was selected, so nothing in the list itself said the
        // click landed — this is the only confirmation there is.
        if (assignedCount > 0) {
          showUndoToast({title: t('undo.assigned', {count: assignedCount, name: assignee})})
        }
      } finally {
        setBusy(false)
      }
    },
    [assignableSource, selected, showUndoToast, t],
  )

  // Same one-source-only gate as `assignableSource` above — a selection
  // only ever offers one of `assign`/`transfer`, never both (see
  // `InboxSourceResult.transfer`'s own doc comment), so this and
  // `assignableSource` are never both defined at once in practice.
  const transferableSource =
    selected.length > 0 && selected.every((row) => row.sourceName === selected[0].sourceName)
      ? reports[selected[0].sourceName]?.transfer
      : undefined

  const confirmTransfer = useCallback(
    async (userId: string) => {
      if (!transferableSource) return
      const targets = [...selected]
      const recipient = transferableSource.users.find((user) => user.id === userId)?.label ?? userId

      setBusy(true)
      try {
        const results = await Promise.allSettled(
          targets.map((row) => transferableSource.toUser(row.item, userId)),
        )

        let transferredCount = 0
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[sanity-plugin-structure-inbox] could not transfer item', result.reason)
          } else {
            transferredCount += 1
          }
        })

        setSelectedKeys([])

        // Unlike assign, a transferred item actually leaves this editor's
        // own list — the row itself vanishing is confirmation enough for
        // that half, but not for *where* it went, so this still says who.
        if (transferredCount > 0) {
          showUndoToast({
            title: t('undo.transferred', {count: transferredCount, name: recipient}),
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [transferableSource, selected, showUndoToast, t],
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

  // The AI genuinely finding no date to suggest is a real, non-error
  // outcome (`SnoozeSuggestionState`'s own `'none'` status below) — distinct
  // from `useAiRead`'s own `null`-means-`'error'` convention (see its doc
  // comment), so a resolved "nothing to suggest" is encoded inside `T`
  // (`found: false`) instead of as `null`, and mapped to `'none'` only in
  // the `snoozeSuggestion` derivation just below.
  const runSuggestSnooze = useCallback(async (): Promise<
    {found: true; until: string; reason?: string} | {found: false} | null
  > => {
    // Belt-and-suspenders against a direct call some other code path might
    // make: `handleSuggestSnooze` below already guards on the same
    // condition before ever calling `start()`.
    if (!suggestSnoozeForRow || !singleSelectedRow) return null
    const result = await suggestSnoozeForRow(singleSelectedRow.item)
    return result ? {found: true, ...result} : {found: false}
  }, [suggestSnoozeForRow, singleSelectedRow])

  const snoozeSuggestionRead = useAiRead(runSuggestSnooze, 'suggest-snooze failed')

  const snoozeSuggestion: SnoozeSuggestionState =
    snoozeSuggestionRead.state.status === 'done'
      ? snoozeSuggestionRead.state.data.found
        ? {status: 'done', until: snoozeSuggestionRead.state.data.until, reason: snoozeSuggestionRead.state.data.reason}
        : {status: 'none'}
      : snoozeSuggestionRead.state

  // Reset to idle whenever the single-selected row changes, so a stale
  // suggestion from a previous row never lingers under a new one — same
  // reasoning the old effect's own `cancelled` flag already had, just
  // without firing a request to go with it. Nothing here spends a credit —
  // that only ever happens from `handleSuggestSnooze`, below, on an explicit
  // click.
  useEffect(() => {
    snoozeSuggestionRead.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `snoozeSuggestionRead.reset` is referentially stable; `snoozeSuggestionRead` itself is not.
  }, [singleSelectedRow?.key])

  // The one place `suggestSnooze` is ever actually called — an explicit
  // click (`SelectionActions`' own "Suggest a time" trigger), never a
  // selection change. `suggestSnooze` bills a real AI credit per call (see
  // this plan's own doc comment), so unlike every other derived value in
  // this file, this must never fire on its own.
  const handleSuggestSnooze = useCallback(() => {
    if (!suggestSnoozeForRow || !singleSelectedRow) return
    snoozeSuggestionRead.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `snoozeSuggestionRead.start` is referentially stable; `snoozeSuggestionRead` itself is not.
  }, [suggestSnoozeForRow, singleSelectedRow])

  // The trigger and its resolved state are only ever meaningful together —
  // gates both props passed to `SelectionActions` below so a two-row
  // selection (where `suggestSnoozeForRow` is undefined) shows neither.
  const canSuggestSnooze = view === 'open' && Boolean(suggestSnoozeForRow)

  // Same gate as the snooze suggestion above (exactly one selected row, Open
  // view only) — `assignableSource` already requires every selected row to
  // share one source, trivially true for exactly one.
  const suggestAssigneeForRow = singleSelectedRow ? assignableSource?.suggestAssignee : undefined

  const [assigneeSuggestion, setAssigneeSuggestion] = useState<AssigneeSuggestionState>({
    status: 'idle',
  })

  useEffect(() => {
    if (!singleSelectedRow || !suggestAssigneeForRow) {
      setAssigneeSuggestion({status: 'idle'})
      return undefined
    }

    let cancelled = false
    setAssigneeSuggestion({status: 'loading'})

    suggestAssigneeForRow(singleSelectedRow.item)
      .then((result) => {
        if (!cancelled) {
          setAssigneeSuggestion(result ? {status: 'done', ...result} : {status: 'none'})
        }
        return undefined
      })
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] suggest-assignee failed', error)
        if (!cancelled) setAssigneeSuggestion({status: 'error'})
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
      const category = item.category ?? t(report.source.title)
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
    // A row's own avatar reuses one picker for whichever of `assign`/
    // `transfer` its source actually offers — never both (see
    // `InboxSourceResult.transfer`'s own doc comment) — so this falls back
    // to `transfer` only when there's no `assign` to prefer instead.
    const assign = report?.assign
    const transfer = report?.transfer
    return (
      <RowBoundary key={row.key} resetKey={row.item}>
        <InboxRow
          assigneeReadOnly={report?.assigneeReadOnly}
          assignableUsers={assign?.users ?? transfer?.users}
          reassignVerb={assign ? t('action.assign') : transfer ? t('action.transfer') : undefined}
          done={view === 'cleared'}
          initialAssessment={initialAssessment}
          item={row.item}
          leaving={leavingKeys.has(row.key)}
          menuActions={buildMenuActions(row, report)}
          onAssess={onAssess}
          onProposeFix={report?.proposeFix}
          onFixApplied={handleFixApplied}
          onEdit={
            report?.update
              ? () => setEditingKey(row.key)
              : report?.openDetail
                ? () => report.openDetail?.(row.item)
                : undefined
          }
          onReassign={
            assign
              ? (item, userId) => {
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
              : transfer
                ? (item, userId) => {
                    const recipient = transfer.users.find((u) => u.id === userId)?.label ?? userId
                    transfer
                      .toUser(item, userId)
                      .then(() =>
                        showUndoToast({
                          title: t('undo.transferred', {count: 1, name: recipient}),
                        }),
                      )
                      .catch((error: unknown) => {
                        console.error('[sanity-plugin-structure-inbox] could not transfer item', error)
                      })
                  }
                : undefined
          }
          onUnassign={
            assign?.unassign
              ? (item) => {
                  const unassign = assign.unassign
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
      </RowBoundary>
    )
  }

  return (
    <Stack gap={3}>
      {errors.map((report) => (
        <Card key={report.source.name} padding={3} radius={2} tone="critical">
          <Flex align="center" gap={3} justify="space-between">
            <Text size={1}>
              {t(report.source.title)}: {report.error?.message ?? t('source.error.title')}
            </Text>
            {onRetrySource && (
              // Ghost mode, same reasoning as `SectionCard`'s own retry
              // button: recovering from an error is not the primary thing on
              // this pane. `BoundedSourceFeed`'s boundary (in `Inbox.tsx`)
              // has its own bounded budget (`SectionErrorBoundary.MAX_RESETS`)
              // independent of this button staying visible — a spent budget
              // just means the next click remounts nothing, not that this
              // control disappears (unlike `SectionCard`'s, this one has no
              // per-click signal of the boundary's own remaining budget,
              // since the boundary lives one layer up in `Inbox.tsx`).
              <Button
                fontSize={1}
                mode="ghost"
                onClick={() => onRetrySource(report.source.name)}
                text={t('source.error.retry')}
              />
            )}
          </Flex>
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
            own doc comment for why. Spacing *between* simultaneous result
            cards is `Inbox.tsx`'s own `mainColumnResults` `Stack`'s `gap`
            (deliberately not each card's own `marginBottom` — see that
            Stack's own comment); this wrapper only supplies the
            horizontal inset so a card doesn't sit flush against this
            outer Card's own rounded border. */}
        {results && (
          <Box paddingTop={3} paddingX={3}>
            {results}
          </Box>
        )}
        {/* The main column merges every source into one list, but it's
            still one section, and it looked like an afterthought without a
            header of its own to say so. `minHeight: 54` is this row's own
            measured value (the filter bar's own row rendered at 54px, the
            selection bar's at 50px), unrelated to `SectionCard`'s header
            height (58px) — a different number for a different row, not an
            equivalence to maintain. It's a floor, not a fixed height —
            Ask's own row (narrow) or its own answer text (either width) can
            still grow this taller. No `tone="transparent"` (unlike the actions
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
                <AskInbox
                  context={context}
                  getProjectDigest={getProjectDigest}
                  onResultChange={onAskResultChange}
                  onSelect={setSelectedKeys}
                  result={askResult}
                  rows={rows}
                />
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
                  onQuickFix={
                    view === 'open' && quickFixableTargets.length > 0 ? confirmQuickFix : undefined
                  }
                  onSnooze={view === 'open' ? confirmSnooze : undefined}
                  onSnoozeUntil={view === 'open' ? confirmSnoozeUntil : undefined}
                  onSuggestSnooze={canSuggestSnooze ? handleSuggestSnooze : undefined}
                  onTransfer={view === 'open' && transferableSource ? confirmTransfer : undefined}
                  snoozeSuggestion={canSuggestSnooze ? snoozeSuggestion : undefined}
                  transferableUsers={view === 'open' ? transferableSource?.users : undefined}
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
        <CountBadge>{props.count}</CountBadge>
      </Flex>
    </Box>
  )
}
