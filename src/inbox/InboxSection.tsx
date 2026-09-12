import {Badge, Box, Stack, Text} from '@sanity/ui'
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

  const {items, loading, error, resolve, create, assess, assign, remove} = source.useItems()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

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

    if (!resolve) {
      for (const item of selected) dismissals.dismiss(source.name, item.id)
      setSelectedIds([])
      return
    }

    const targets = [...selected]

    setBusy(true)
    try {
      // `allSettled` rather than `all`: one item failing should not strand the
      // others, and each is marked done only once its own resolve succeeded.
      const results = await Promise.allSettled(targets.map((item) => resolve(item)))

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') dismissals.dismiss(source.name, targets[index].id)
        else console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
      })

      setSelectedIds([])
    } finally {
      setBusy(false)
    }
  }, [view, resolve, selected, dismissals, snoozes, source.name])

  /** Only reachable from the open view — see `onSnooze` on `SelectionActions`. */
  const confirmSnooze = useCallback(
    (preset: SnoozePreset) => {
      const until = resolveSnoozeUntil(preset)
      for (const item of selected) snoozes.snooze(source.name, item.id, until)
      setSelectedIds([])
    },
    [selected, snoozes, source.name],
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

      setBusy(true)
      try {
        const results = await Promise.allSettled(targets.map((item) => assign.toUser(item, userId)))
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[sanity-plugin-structure-inbox] could not assign item', result.reason)
          }
        })
        setSelectedIds([])
      } finally {
        setBusy(false)
      }
    },
    [assign, selected],
  )

  const isEmpty = visible.length === 0

  return (
    <SectionCard
      badge={open.length > 0 ? <Badge fontSize={0}>{open.length}</Badge> : undefined}
      // Handed over rather than thrown: throwing here would escape the boundary
      // that this very component renders, and take the whole tool with it.
      error={error}
      icon={source.icon}
      // Says whose list this is. Without it, a personal task list and the
      // team's forgotten drafts look identical, while a tick means something
      // different in each.
      note={source.audience === 'mine' ? t('audience.mine') : t('audience.everyone')}
      title={source.title}
      toolbar={
        selected.length > 0 ? (
          <SelectionActions
            assignableUsers={view === 'open' ? assign?.users : undefined}
            busy={busy}
            count={selected.length}
            onAssign={view === 'open' && assign ? confirmAssign : undefined}
            onCancel={clearSelection}
            onConfirm={confirmSelection}
            onSnooze={view === 'open' ? confirmSnooze : undefined}
            resolves={Boolean(resolve)}
            view={view}
          />
        ) : undefined
      }
    >
      {view === 'open' && create && <CreateItemRow onCreate={create} />}

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
        <Stack gap={1} padding={1}>
          {visible.map((item) => (
            <InboxRow
              compact={compact}
              done={view === 'done'}
              item={item}
              key={item.id}
              onAssess={assess}
              onRemove={remove}
              onSelectedChange={handleSelectedChange}
              selected={selectedIds.includes(item.id)}
            />
          ))}
        </Stack>
      )}
    </SectionCard>
  )
}
