import {InboxIcon} from '@sanity/icons/Inbox'
import {Box, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {type ReactNode, useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {resolveSnoozeUntil, type SnoozePreset} from '../store/snoozePresets'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {CreateItemRow} from './CreateItemRow'
import {matchesInboxFilters} from './inboxFilterSentinels'
import {InboxRow} from './InboxRow'
import {mergeRows} from './mergeItems'
import {SelectionActions} from './SelectionActions'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxView} from './types'
import {useDelayedUnmount} from './useDelayedUnmount'
import {EXIT_ANIMATION_MS, useUndoToast} from './useUndoToast'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long the selection bar takes to ease open or shut — see `useDelayedUnmount`. */
const SELECTION_BAR_TRANSITION_MS = 200

interface MergedListProps {
  reports: Record<string, SourceReport>
  /** The sources array as configured — also the merge tiebreak, see `mergeRows`. */
  order: string[]
  view: InboxView
  dismissals: Dismissals
  snoozes: Snoozes
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
  const {reports, order, view, dismissals, snoozes, assigneeFilter, typeFilter, filterBar} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const allRows = useMemo(() => mergeRows(reports, order, view), [reports, order, view])

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

  // The bar itself stays mounted a beat after the selection empties, so the
  // grid-row transition below has something to shrink around instead of the
  // content vanishing out from under an animation already in progress.
  const showSelectionBar = useDelayedUnmount(selected.length > 0, SELECTION_BAR_TRANSITION_MS)
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

  const confirmSelection = useCallback(async () => {
    if (view === 'done') {
      for (const row of selected) dismissals.restore(row.sourceName, row.item.id)
      setSelectedKeys([])
      return
    }

    if (view === 'snoozed') {
      for (const row of selected) snoozes.wake(row.sourceName, row.item.id)
      setSelectedKeys([])
      return
    }

    const targets = [...selected]

    // Cleared immediately — the bar disappearing is the confirmation the
    // click landed; the rows themselves fade a beat longer before the
    // mutation that actually removes them runs, see `EXIT_ANIMATION_MS`.
    setSelectedKeys([])
    setLeavingKeys((current) => new Set([...current, ...targets.map((row) => row.key)]))
    await wait(EXIT_ANIMATION_MS)

    setBusy(true)
    try {
      // Each row resolves through its own source's `resolve` — a mixed
      // selection is fine, `Promise.allSettled` means one item failing (or
      // having no `resolve` at all) never strands the rest.
      const results = await Promise.allSettled(
        targets.map((row) => {
          const resolve = reports[row.sourceName]?.resolve
          return resolve ? resolve(row.item) : Promise.resolve()
        }),
      )

      let dismissedCount = 0
      results.forEach((result, index) => {
        const row = targets[index]
        if (result.status === 'fulfilled') {
          dismissals.dismiss(row.sourceName, row.item.id)
          dismissedCount += 1
        } else {
          console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
        }
      })

      setLeavingKeys((current) => {
        const next = new Set(current)
        targets.forEach((row) => next.delete(row.key))
        return next
      })

      if (dismissedCount > 0) {
        showUndoToast({
          title: t('undo.markedDone', {count: dismissedCount}),
          onUndo: () => targets.forEach((row) => dismissals.restore(row.sourceName, row.item.id)),
        })
      }
    } finally {
      setBusy(false)
    }
  }, [view, selected, reports, dismissals, snoozes, showUndoToast, t])

  /** Snoozing is a plugin-level capability, not a per-source one — every item can be, regardless of where it came from. */
  const confirmSnooze = useCallback(
    (preset: SnoozePreset) => {
      const until = resolveSnoozeUntil(preset)
      const targets = [...selected]

      setSelectedKeys([])
      setLeavingKeys((current) => new Set([...current, ...targets.map((row) => row.key)]))

      setTimeout(() => {
        for (const row of targets) snoozes.snooze(row.sourceName, row.item.id, until)

        setLeavingKeys((current) => {
          const next = new Set(current)
          targets.forEach((row) => next.delete(row.key))
          return next
        })

        showUndoToast({
          title: t('undo.snoozed', {count: targets.length}),
          onUndo: () => targets.forEach((row) => snoozes.wake(row.sourceName, row.item.id)),
        })
      }, EXIT_ANIMATION_MS)
    },
    [selected, snoozes, showUndoToast, t],
  )

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

  const reportsInOrder = order
    .map((name) => reports[name])
    .filter((r): r is SourceReport => Boolean(r))
  // `update` too, not just `create`: the same dialog hosts both, and a
  // source could in principle offer editing without offering creation.
  const creators = reportsInOrder.filter((r) => r.create || r.update)
  // Offered only when exactly one configured source can create items: with
  // two or more, "save to todos" would be ambiguous about which list a copy
  // goes into, the same reasoning `assign` already applies to a mixed-source
  // selection.
  const soleCreator = creators.length === 1 ? creators[0] : undefined
  const errors = reportsInOrder.filter((r) => r.error)

  const confirmSaveToTodos = useCallback(async () => {
    if (!soleCreator?.create) return
    const targets = [...selected]

    setBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((row) =>
          // `create` is typed `Promise<void> | void` — wrapped so a source
          // that creates synchronously (or throws synchronously) still
          // yields a settled promise instead of aborting this `.map()`
          // before `allSettled` ever runs.
          Promise.resolve().then(() =>
            soleCreator.create!({
              title: row.item.title,
              description: row.item.description,
              dueBy: row.item.dueBy,
            }),
          ),
        ),
      )

      let savedCount = 0
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error(
            '[sanity-plugin-structure-inbox] could not save item to todos',
            result.reason,
          )
        } else {
          savedCount += 1
        }
      })

      setSelectedKeys([])

      if (savedCount > 0) {
        showUndoToast({title: t('undo.savedToTodos', {count: savedCount})})
      }
    } finally {
      setBusy(false)
    }
  }, [soleCreator, selected, showUndoToast, t])

  // A configured source that has not reported at all yet counts as loading,
  // the same as one that has reported `loading: true` — otherwise the first
  // render, before any `SourceFeed` effect has fired, flashes "All clear."
  const anyLoading = order.some((name) => !reports[name] || reports[name]?.loading)
  const isEmpty = rows.length === 0

  const describeSource = useCallback(
    (report: SourceReport | undefined, item: InboxItem): string | undefined => {
      if (!report) return undefined
      // An avatar chip already says who — restating it as "Assigned to you"
      // right next to that avatar was the "so much stuff on those items"
      // this row's own assignee avatar was added to fix.
      if (item.assignee) return report.source.title
      // An item nobody has picked up yet, from a source that actually offers
      // `assign`, already shows the faint placeholder avatar
      // (`InboxRow.tsx`) — "Unassigned" here names that placeholder instead
      // of restating the source's audience, which said nothing about whether
      // this particular item has anyone on it. A source with no `assign` at
      // all (a release, a todo) was never individually assignable, so its
      // audience is still the only true thing to say about it.
      if (report.assign) return `${report.source.title} · ${t('assignee.unassigned')}`
      const audience =
        report.source.audience === 'mine' ? t('audience.mine') : t('audience.everyone')
      return `${report.source.title} · ${audience}`
    },
    [t],
  )

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

      {/* Its own zero-gap `Stack`, not a direct child of the outer one above:
          this Box is always mounted (collapsed to `0fr` when nothing is
          selected), and the outer Stack's `gap` applies between siblings
          regardless of a collapsed one's actual rendered height — that
          added a permanent 12px gap above the card below even with nothing
          else on screen, which is exactly what put this box and
          `SectionCard`'s own outer box (no such always-mounted sibling) out
          of alignment. */}
      <Stack gap={0}>
        {/* Grid rather than a plain conditional render: the whole list used to
            jump the instant selection changed, since the bar's block appearing
            or disappearing is otherwise an instant reflow. `0fr`/`1fr` on a
            single grid row eases that height open and shut instead — see
            `useDelayedUnmount` for why the bar itself outlives the collapse. */}
        <Box
          style={{
            display: 'grid',
            gridTemplateRows: selected.length > 0 ? '1fr' : '0fr',
            // The 12px the outer Stack used to contribute unconditionally —
            // restored here, but only while the bar is actually visible, so
            // it still separates the bar from the card below without also
            // pushing the (collapsed, invisible) card down when it isn't.
            marginBottom: selected.length > 0 ? 12 : 0,
            transition: `grid-template-rows ${SELECTION_BAR_TRANSITION_MS}ms ease, margin-bottom ${SELECTION_BAR_TRANSITION_MS}ms ease`,
          }}
        >
        <Box style={{minHeight: 0, overflow: 'hidden'}}>
          {showSelectionBar && (
            <SelectionActions
              assignableUsers={view === 'open' ? assignableSource?.users : undefined}
              busy={busy}
              count={displayCount}
              onAssign={view === 'open' && assignableSource ? confirmAssign : undefined}
              onCancel={clearSelection}
              onConfirm={confirmSelection}
              onSaveToTodos={view === 'open' && soleCreator ? confirmSaveToTodos : undefined}
              onSnooze={view === 'open' ? confirmSnooze : undefined}
              resolves={selected.every((row) => Boolean(reports[row.sourceName]?.resolve))}
              view={view}
            />
          )}
        </Box>
      </Box>

      <Card border overflow="hidden" radius={3} shadow={0}>
        {/* Matches the header every `aside` source's own card already has
            (`SectionCard`) — the main column merges every source into one
            list, but it's still one section, and it looked like an
            afterthought without a header of its own to say so. */}
        <Card borderBottom paddingX={3} paddingY={3} radius={0} tone="transparent">
          {/* Extra `paddingLeft={2}` beyond the Card's own `padding={3}` —
              see the "Select all" row below, and `InboxRow.tsx`'s own
              checkbox wrapper, for the same nudge and why: a row's checkbox
              carries this same extra padding, and the theme's spacing scale
              does not have a step between `3` and `4` that lines up with it,
              so it is added here explicitly rather than by bumping the
              Card's own padding a full step. The icon's own glyph sits
              slightly inset from its bounding box at this size, hence `2`
              rather than the `1` that lined up the plain checkbox below. */}
          <Flex align="center" gap={3} justify="space-between" paddingLeft={2} wrap="wrap">
            <Flex align="center" gap={3}>
              <Text muted size={2}>
                <InboxIcon />
              </Text>
              <Text size={1} weight="semibold">
                {t('inbox.title')}
              </Text>
            </Flex>

            {filterBar}
          </Flex>
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
              {view === 'done'
                ? t('source.noneDone')
                : view === 'snoozed'
                  ? t('source.noneSnoozed')
                  : t('source.empty')}
            </Text>
          </Box>
        ) : (
          <Stack>
            <Card borderBottom paddingX={3} paddingY={2}>
              {/* `paddingLeft={1}` on the `Flex` below, on top of this
                  Card's own `padding={3}`: a row's own checkbox sits under
                  that same extra unit (`InboxRow.tsx`'s own checkbox
                  wrapper), which this single-layer header doesn't otherwise
                  have — see the header above for the identical adjustment.
                  The theme's spacing scale has no step between `3` and `4`
                  that lines up with it, which is why this is added as an
                  explicit inner `paddingLeft` rather than by bumping the
                  Card's own padding a full step. */}
              {/* A native `<label>`, not a `Flex` with a separately-clickable
                  `Checkbox` — wrapping the checkbox and its own text in one
                  real label is what makes clicking the words "Select all"
                  toggle it too, for free, the same as any other checkbox
                  label on the web. */}
              <Flex align="center" as="label" paddingLeft={1} style={{cursor: 'pointer'}}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  title={t('selection.selectAll')}
                />
                <Box paddingLeft={2}>
                  <Text muted size={0}>
                    {t('selection.selectAll')}
                  </Text>
                </Box>
              </Flex>
            </Card>
            {/* Capped, not left to grow with however many rows are open —
                the persistent sidebar next to this column has its own
                (roughly stable) height, and an Inbox list that could grow
                taller than it forever made that neighbour look like an
                afterthought. `560px` is a rough eyeball (~9 rows), not a
                pixel-synced measurement against the sidebar's actual
                rendered height — that would need a `ResizeObserver` and
                isn't justified yet. */}
            <Box style={{maxHeight: 560, overflowY: 'auto'}}>
              <Stack gap={1} padding={1}>
                {rows.map((row) => {
                const report = reports[row.sourceName]
                return (
                  <InboxRow
                    assignableUsers={report?.assign?.users}
                    done={view === 'done'}
                    item={row.item}
                    key={row.key}
                    leaving={leavingKeys.has(row.key)}
                    onAssess={report?.assess}
                    onEdit={report?.update ? () => setEditingKey(row.key) : undefined}
                    onlySelected={selected.length === 1 && selectedKeys.includes(row.key)}
                    onReassign={
                      report?.assign
                        ? (item, userId) => {
                            const assign = report.assign
                            if (!assign) return
                            const assignee =
                              assign.users.find((u) => u.id === userId)?.label ?? userId
                            assign
                              .toUser(item, userId)
                              .then(() =>
                                showUndoToast({
                                  title: t('undo.assigned', {count: 1, name: assignee}),
                                }),
                              )
                              .catch((error: unknown) => {
                                console.error(
                                  '[sanity-plugin-structure-inbox] could not assign item',
                                  error,
                                )
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
                                console.error(
                                  '[sanity-plugin-structure-inbox] could not unassign item',
                                  error,
                                )
                              })
                          }
                        : undefined
                    }
                    onRemove={report?.remove}
                    onSelectedChange={(item: InboxItem, isSelected: boolean) =>
                      setSelectedKeys((current) =>
                        isSelected
                          ? [...current, row.key]
                          : current.filter((existing) => existing !== row.key),
                      )
                    }
                    selected={selectedKeys.includes(row.key)}
                    sourceLabel={describeSource(report, row.item)}
                  />
                )
              })}
              </Stack>
            </Box>
          </Stack>
        )}
      </Card>
      </Stack>
    </Stack>
  )
}
