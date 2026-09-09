import {Badge, Box, Stack, Text} from '@sanity/ui'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {isDismissed} from '../store/dismissals'
import {type Dismissals} from '../store/useDismissals'
import {SectionCard} from '../ui/SectionCard'
import {InboxRow} from './InboxRow'
import {SelectionActions} from './SelectionActions'
import {type InboxItem, type InboxSource} from './types'

interface InboxSectionProps {
  source: InboxSource
  dismissals: Dismissals
  showDone: boolean
  compact?: boolean
  /** Reports the open count so the pane can show a total. */
  onCount: (sourceName: string, count: number) => void
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
  const {source, dismissals, showDone, compact = false, onCount} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, resolve} = source.useItems()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const {open, done} = useMemo(() => {
    const openItems: InboxItem[] = []
    const doneItems: InboxItem[] = []

    for (const item of items) {
      if (isDismissed(dismissals.state, source.name, item.id, item.timestamp)) doneItems.push(item)
      else openItems.push(item)
    }

    return {open: openItems, done: doneItems}
  }, [items, dismissals.state, source.name])

  useEffect(() => {
    onCount(source.name, open.length)
  }, [onCount, source.name, open.length])

  const visibleDone = useMemo(() => (showDone ? done : []), [showDone, done])
  const visible = useMemo(() => [...open, ...visibleDone], [open, visibleDone])
  const doneIds = useMemo(() => new Set(visibleDone.map((item) => item.id)), [visibleDone])

  // A row can disappear while selected — someone else publishes the draft, or
  // "Show done" is switched off. Keeping the selection pinned to what is on
  // screen stops the action bar from counting rows nobody can see.
  const selected = useMemo(
    () => visible.filter((item) => selectedIds.includes(item.id)),
    [visible, selectedIds],
  )

  const doneCount = useMemo(
    () => selected.filter((item) => doneIds.has(item.id)).length,
    [selected, doneIds],
  )

  const handleSelectedChange = useCallback((item: InboxItem, isSelected: boolean) => {
    setSelectedIds((current) =>
      isSelected ? [...current, item.id] : current.filter((id) => id !== item.id),
    )
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const dismissSelected = useCallback(() => {
    for (const item of selected) {
      if (!doneIds.has(item.id)) dismissals.dismiss(source.name, item.id)
    }
    setSelectedIds([])
  }, [selected, doneIds, dismissals, source.name])

  const restoreSelected = useCallback(() => {
    for (const item of selected) {
      if (doneIds.has(item.id)) dismissals.restore(source.name, item.id)
    }
    setSelectedIds([])
  }, [selected, doneIds, dismissals, source.name])

  const resolveSelected = useCallback(async () => {
    if (!resolve) return

    const targets = selected.filter((item) => !doneIds.has(item.id))

    setBusy(true)
    try {
      // `allSettled` rather than `all`: one item failing to resolve should not
      // strand the others, and each is only marked done once its own resolve
      // actually succeeded — an item that stays open is the honest outcome.
      const results = await Promise.allSettled(targets.map((item) => resolve(item)))

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') dismissals.dismiss(source.name, targets[index].id)
        else console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
      })

      setSelectedIds([])
    } finally {
      setBusy(false)
    }
  }, [resolve, selected, doneIds, dismissals, source.name])

  // A source that throws inside its hook is caught by `SectionCard`; one that
  // reports an error in its result is raised here so the same card shows it.
  if (error) throw error

  const isEmpty = visible.length === 0

  return (
    <SectionCard
      badge={open.length > 0 ? <Badge fontSize={0}>{open.length}</Badge> : undefined}
      icon={source.icon}
      title={source.title}
      toolbar={
        selected.length > 0 ? (
          <SelectionActions
            busy={busy}
            count={selected.length}
            doneCount={doneCount}
            onClear={clearSelection}
            onDismiss={dismissSelected}
            onResolve={resolveSelected}
            onRestore={restoreSelected}
            resolves={Boolean(resolve)}
          />
        ) : undefined
      }
    >
      {loading && isEmpty ? (
        <Box padding={3}>
          <Text muted size={1}>
            {t('source.loading')}
          </Text>
        </Box>
      ) : isEmpty ? (
        <Box padding={3}>
          <Text muted size={1}>
            {t('source.empty')}
          </Text>
        </Box>
      ) : (
        <Stack gap={1} padding={1}>
          {open.map((item) => (
            <InboxRow
              compact={compact}
              item={item}
              key={item.id}
              onSelectedChange={handleSelectedChange}
              selected={selectedIds.includes(item.id)}
            />
          ))}
          {visibleDone.map((item) => (
            <InboxRow
              compact={compact}
              done
              item={item}
              key={item.id}
              onSelectedChange={handleSelectedChange}
              selected={selectedIds.includes(item.id)}
            />
          ))}
        </Stack>
      )}
    </SectionCard>
  )
}
