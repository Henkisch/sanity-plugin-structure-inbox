import {Box, Stack, Text} from '@sanity/ui'
import {useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {isDismissed} from '../store/dismissals'
import {isSnoozed} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {SectionCard} from '../ui/SectionCard'
import {CreateItemRow} from './CreateItemRow'
import {InboxRow} from './InboxRow'
import {type InboxItem, type InboxSource, type InboxView} from './types'
import {useUndoToast} from './useUndoToast'

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
 * One source's group in the inbox — always an `aside` source today (`main`
 * sources render through `MergedList` instead, which is where the bulk
 * selection/mark-done/snooze bar this component used to carry now lives
 * exclusively). Aside content is ambient context to glance at and open, not
 * a worklist to multi-select and clear, so this is a plain read-only list:
 * open, done and snoozed tabs still split it, and a single row can still be
 * reassigned, asked about, or removed on its own — just nothing bulk.
 *
 * Each source gets its own component so its `useItems` hook has a stable call
 * position of its own. A single component looping over sources would break the
 * rules of hooks the moment a Studio's config changed.
 */
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, snoozes, view, compact = false, onCount, onVisibleCount} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, create, assess, assign, remove, update} = source.useItems()
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
          <Stack gap={1} padding={1}>
            {visible.map((item) => (
              <InboxRow
                assignableUsers={assign?.users}
                compact={compact}
                done={view === 'done'}
                item={item}
                key={item.id}
                onAssess={assess}
                onEdit={update ? () => setEditingId(item.id) : undefined}
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
              />
            ))}
          </Stack>
        </Stack>
      )}
    </SectionCard>
  )
}
