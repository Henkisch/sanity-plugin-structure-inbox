import {Box, Button, Stack, Text} from '@sanity/ui'
import {useCallback, useEffect, useMemo, useState} from 'react'
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
}

/**
 * One source's group in the inbox — always an `aside` source today (`main`
 * sources render through `MergedList` instead, which is where the bulk
 * selection/mark-done/snooze bar this component used to carry now lives
 * exclusively). Aside content is ambient context to glance at and open, not
 * a worklist to triage, so this is a plain read-only list: open, done and
 * snoozed tabs still split it, and a single row can still be reassigned on
 * its own — but no per-row "Ask AI" or delete either, both of which only
 * make sense for something on a worklist, and no bulk actions at all.
 *
 * Each source gets its own component so its `useItems` hook has a stable call
 * position of its own. A single component looping over sources would break the
 * rules of hooks the moment a Studio's config changed.
 */
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, snoozes, view, compact = false, onCount} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, create, assign, update, action} = source.useItems()
  const showUndoToast = useUndoToast()

  // The item being edited, if any — see `MergedList` for the full reasoning.
  const [editingId, setEditingId] = useState<string | null>(null)

  // Pending state for `action` lives here, not inside the source — the
  // source only knows how to run it, not whether a click is in flight.
  const [actionRunning, setActionRunning] = useState(false)
  const handleAction = useCallback(() => {
    if (!action) return
    setActionRunning(true)
    action
      .run()
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] source action failed', error)
      })
      .finally(() => setActionRunning(false))
  }, [action])

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

  const {open, cleared, snoozed} = useMemo(() => {
    const openItems: InboxItem[] = []
    const clearedItems: InboxItem[] = []
    const snoozedItems: InboxItem[] = []

    for (const item of items) {
      if (isDismissed(dismissals.state, source.name, item.id, item.changedAt)) {
        clearedItems.push(item)
      } else if (isSnoozed(snoozes.state, source.name, item.id, now, item.changedAt)) {
        snoozedItems.push(item)
      } else {
        openItems.push(item)
      }
    }

    return {open: openItems, cleared: clearedItems, snoozed: snoozedItems}
  }, [items, dismissals.state, snoozes.state, source.name, now])

  useEffect(() => {
    onCount(source.name, open.length)
  }, [onCount, source.name, open.length])

  // Exactly one of the three at a time: the tabs mean different things, and
  // interleaving them was what made a cleared or snoozed row look like an
  // open one.
  const visible = view === 'cleared' ? cleared : view === 'snoozed' ? snoozed : open

  const isEmpty = visible.length === 0
  const editingItem = editingId ? visible.find((item) => item.id === editingId) : undefined

  return (
    <SectionCard
      badge={
        action && (
          <Button
            disabled={actionRunning}
            fontSize={1}
            icon={action.icon}
            mode="ghost"
            onClick={handleAction}
            padding={2}
            text={actionRunning ? (action.pendingLabel ?? action.label) : action.label}
          />
        )
      }
      // Handed over rather than thrown: throwing here would escape the boundary
      // that this very component renders, and take the whole tool with it.
      error={error}
      // Only for `mine`: `everyone` is the common case (most sources default
      // to it), and naming it on every header read as a leftover rather than
      // information — the same reasoning `describeSource` in `MergedList`
      // now applies per row. A personal source is the one worth calling out.
      note={source.audience === 'mine' ? t('audience.mine') : undefined}
      title={t(source.title)}
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
            {view === 'cleared'
              ? t('source.noneCleared')
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
                done={view === 'cleared'}
                item={item}
                key={item.id}
                onEdit={update ? () => setEditingId(item.id) : undefined}
                reassignVerb={assign ? t('action.assign') : undefined}
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
              />
            ))}
          </Stack>
        </Stack>
      )}
    </SectionCard>
  )
}
