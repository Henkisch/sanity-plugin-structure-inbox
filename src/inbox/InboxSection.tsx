import {Box, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {isDismissed} from '../store/dismissals'
import {resolveSnoozeUntil, type SnoozePreset} from '../store/snoozePresets'
import {isSnoozed} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {SectionCard} from '../ui/SectionCard'
import {CreateItemRow} from './CreateItemRow'
import {InboxRow} from './InboxRow'
import {SelectionActions} from './SelectionActions'
import {type InboxItem, type InboxSource, type InboxView} from './types'
import {useDelayedUnmount} from './useDelayedUnmount'
import {EXIT_ANIMATION_MS, useUndoToast} from './useUndoToast'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long the selection bar takes to ease open or shut — see `useDelayedUnmount`. */
const SELECTION_BAR_TRANSITION_MS = 200

interface InboxSectionProps {
  source: InboxSource
  dismissals: Dismissals
  snoozes: Snoozes
  view: InboxView
  compact?: boolean
  /** Reports the open count so the pane can show a total. */
  onCount: (sourceName: string, count: number) => void
  /**
   * Reports the count for whichever view is active — unlike `onCount`, which
   * always means "open". Used by the aside column to hide itself when every
   * aside source has nothing to show for the current tab; not needed by the
   * headline, so it's optional.
   */
  onVisibleCount?: (sourceName: string, count: number) => void
}

/**
 * One source's group in the inbox.
 *
 * Each source gets its own component so its `useItems` hook has a stable call
 * position of its own. A single component looping over sources would break the
 * rules of hooks the moment a Studio's config changed. It also keeps selection
 * scoped to one source, which is what makes the action bar unambiguous: every
 * selected row shares the same notion of what "done" can mean.
 */
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, snoozes, view, compact = false, onCount, onVisibleCount} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, resolve, create, assess, assign, remove, update} = source.useItems()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set())
  const showUndoToast = useUndoToast()

  // The item being edited, if any — see `MergedList` for the full reasoning.
  const [editingId, setEditingId] = useState<string | null>(null)

  // A snoozed item wakes on its own once `until` passes, which needs a clock
  // to notice — reading one straight in the render body would be an impure
  // render (React may call render more than once for the same commit). A
  // once-a-minute tick is coarse enough for "wakes up at 08:00", and is the
  // only thing that has to be fresh; every other read of `now` below reuses
  // this same state.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const {open, done, snoozed} = useMemo(() => {
    const openItems: InboxItem[] = []
    const doneItems: InboxItem[] = []
    const snoozedItems: InboxItem[] = []

    for (const item of items) {
      if (isDismissed(dismissals.state, source.name, item.id, item.changedAt)) {
        doneItems.push(item)
      } else if (isSnoozed(snoozes.state, source.name, item.id, now, item.changedAt)) {
        snoozedItems.push(item)
      } else {
        openItems.push(item)
      }
    }

    return {open: openItems, done: doneItems, snoozed: snoozedItems}
  }, [items, dismissals.state, snoozes.state, source.name, now])

  useEffect(() => {
    onCount(source.name, open.length)
  }, [onCount, source.name, open.length])

  // Exactly one of the three at a time: the tabs mean different things, and
  // interleaving them was what made a done or snoozed row look like an open
  // one.
  const visible = view === 'done' ? done : view === 'snoozed' ? snoozed : open

  useEffect(() => {
    onVisibleCount?.(source.name, visible.length)
  }, [onVisibleCount, source.name, visible.length])

  // A row can disappear while selected — someone else publishes the draft, or
  // the editor switches tabs. Deriving the selection from what is on screen
  // means the action bar can never count rows nobody can see, and no effect is
  // needed to clear it.
  const selected = useMemo(
    () => visible.filter((item) => selectedIds.includes(item.id)),
    [visible, selectedIds],
  )

  const handleSelectedChange = useCallback((item: InboxItem, isSelected: boolean) => {
    setSelectedIds((current) =>
      isSelected ? [...current, item.id] : current.filter((id) => id !== item.id),
    )
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  // See `MergedList` for the full reasoning — same jump, same fix, and the
  // same reason this tracks only the count rather than the `selected` array.
  const showSelectionBar = useDelayedUnmount(selected.length > 0, SELECTION_BAR_TRANSITION_MS)
  const [lastCount, setLastCount] = useState(selected.length)
  if (selected.length > 0 && selected.length !== lastCount) setLastCount(selected.length)
  const displayCount = selected.length > 0 ? selected.length : lastCount

  const allSelected = visible.length > 0 && selected.length === visible.length
  const someSelected = selected.length > 0 && !allSelected

  const toggleAll = useCallback(() => {
    setSelectedIds(allSelected ? [] : visible.map((item) => item.id))
  }, [allSelected, visible])

  /**
   * The primary action the selection bar offers, in whichever direction the
   * current tab implies.
   *
   * Marking done means two things at once when the source supports it: complete
   * the item where it lives, then take it out of this editor's inbox. The order
   * matters — an item whose resolve failed stays in the inbox rather than
   * vanishing from one person's view while still open for everyone else.
   */
  const confirmSelection = useCallback(async () => {
    if (view === 'done') {
      for (const item of selected) dismissals.restore(source.name, item.id)
      setSelectedIds([])
      return
    }

    if (view === 'snoozed') {
      for (const item of selected) snoozes.wake(source.name, item.id)
      setSelectedIds([])
      return
    }

    const targets = [...selected]

    // Cleared immediately — the bar disappearing is the confirmation the
    // click landed; the rows themselves fade a beat longer before the
    // mutation that actually removes them runs, see `EXIT_ANIMATION_MS`.
    setSelectedIds([])
    setLeavingIds((current) => new Set([...current, ...targets.map((item) => item.id)]))
    await wait(EXIT_ANIMATION_MS)

    setBusy(true)
    try {
      // `allSettled` rather than `all`: one item failing should not strand the
      // others, and each is marked done only once its own resolve succeeded
      // (or, with no `resolve` at all, unconditionally).
      const results = await Promise.allSettled(
        targets.map((item) => (resolve ? resolve(item) : Promise.resolve())),
      )

      let dismissedCount = 0
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          dismissals.dismiss(source.name, targets[index].id)
          dismissedCount += 1
        } else {
          console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
        }
      })

      setLeavingIds((current) => {
        const next = new Set(current)
        targets.forEach((item) => next.delete(item.id))
        return next
      })

      if (dismissedCount > 0) {
        showUndoToast({
          title: t('undo.markedDone', {count: dismissedCount}),
          onUndo: () => targets.forEach((item) => dismissals.restore(source.name, item.id)),
        })
      }
    } finally {
      setBusy(false)
    }
  }, [view, resolve, selected, dismissals, snoozes, source.name, showUndoToast, t])

  /** Only reachable from the open view — see `onSnooze` on `SelectionActions`. */
  const confirmSnooze = useCallback(
    (preset: SnoozePreset) => {
      const until = resolveSnoozeUntil(preset)
      const targets = [...selected]

      setSelectedIds([])
      setLeavingIds((current) => new Set([...current, ...targets.map((item) => item.id)]))

      setTimeout(() => {
        for (const item of targets) snoozes.snooze(source.name, item.id, until)

        setLeavingIds((current) => {
          const next = new Set(current)
          targets.forEach((item) => next.delete(item.id))
          return next
        })

        showUndoToast({
          title: t('undo.snoozed', {count: targets.length}),
          onUndo: () => targets.forEach((item) => snoozes.wake(source.name, item.id)),
        })
      }, EXIT_ANIMATION_MS)
    },
    [selected, snoozes, source.name, showUndoToast, t],
  )

  /**
   * Only reachable from the open view — see `onAssign` on `SelectionActions`.
   * Assigning creates a real task per item, so — like resolving — failures
   * are per item and one does not strand the rest.
   */
  const confirmAssign = useCallback(
    async (userId: string) => {
      if (!assign) return
      const targets = [...selected]
      const assignee = assign.users.find((user) => user.id === userId)?.label ?? userId

      setBusy(true)
      try {
        const results = await Promise.allSettled(targets.map((item) => assign.toUser(item, userId)))

        let assignedCount = 0
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[sanity-plugin-structure-inbox] could not assign item', result.reason)
          } else {
            assignedCount += 1
          }
        })

        setSelectedIds([])

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
    [assign, selected, showUndoToast, t],
  )

  const isEmpty = visible.length === 0
  const editingItem = editingId ? visible.find((item) => item.id === editingId) : undefined

  return (
    <SectionCard
      // Handed over rather than thrown: throwing here would escape the boundary
      // that this very component renders, and take the whole tool with it.
      error={error}
      icon={source.icon}
      // Only for `mine`: `everyone` is the common case (most sources default
      // to it), and naming it on every header read as a leftover rather than
      // information — the same reasoning `describeSource` in `MergedList`
      // now applies per row. A personal source is the one worth calling out.
      note={source.audience === 'mine' ? t('audience.mine') : undefined}
      title={source.title}
      toolbar={
        // See `MergedList` for why this is a grid that eases open and shut
        // rather than a plain conditional render.
        <Box
          style={{
            display: 'grid',
            gridTemplateRows: selected.length > 0 ? '1fr' : '0fr',
            transition: `grid-template-rows ${SELECTION_BAR_TRANSITION_MS}ms ease`,
          }}
        >
          <Box style={{minHeight: 0, overflow: 'hidden'}}>
            {showSelectionBar && (
              <SelectionActions
                assignableUsers={view === 'open' ? assign?.users : undefined}
                busy={busy}
                count={displayCount}
                onAssign={view === 'open' && assign ? confirmAssign : undefined}
                onCancel={clearSelection}
                onConfirm={confirmSelection}
                onSnooze={view === 'open' ? confirmSnooze : undefined}
                resolves={Boolean(resolve)}
                view={view}
              />
            )}
          </Box>
        </Box>
      }
    >
      {view === 'open' && create && (
        <CreateItemRow
          editing={
            editingItem
              ? {
                  key: editingItem.id,
                  title: editingItem.title,
                  description: editingItem.description,
                  dueBy: editingItem.dueBy,
                  onSave: (input) => {
                    Promise.resolve(update?.(editingItem, input)).catch((error: unknown) => {
                      console.error('[sanity-plugin-structure-inbox] could not update item', error)
                    })
                    setEditingId(null)
                  },
                  onCancel: () => setEditingId(null),
                }
              : undefined
          }
          onCreate={create}
        />
      )}

      {loading && isEmpty ? (
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
            {/* See `MergedList`'s identical header for why this `Flex` gets
                its own extra `paddingLeft={1}` rather than bumping this
                Card's padding a step — it lines this checkbox up with the
                ones on every row below. */}
            <Flex align="center" paddingLeft={1}>
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
          <Stack gap={1} padding={1}>
            {visible.map((item) => (
              <InboxRow
                assignableUsers={assign?.users}
                compact={compact}
                done={view === 'done'}
                item={item}
                key={item.id}
                leaving={leavingIds.has(item.id)}
                onAssess={assess}
                onEdit={update ? () => setEditingId(item.id) : undefined}
                onlySelected={selected.length === 1 && selectedIds.includes(item.id)}
                onReassign={
                  assign
                    ? (targetItem, userId) => {
                        const assignee = assign.users.find((u) => u.id === userId)?.label ?? userId
                        assign
                          .toUser(targetItem, userId)
                          .then(() =>
                            showUndoToast({title: t('undo.assigned', {count: 1, name: assignee})}),
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
                  assign?.unassign
                    ? (targetItem) => {
                        const unassign = assign.unassign
                        if (!unassign) return
                        unassign(targetItem)
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
                onRemove={remove}
                onSelectedChange={handleSelectedChange}
                selected={selectedIds.includes(item.id)}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </SectionCard>
  )
}
