import {Box, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {resolveSnoozeUntil, type SnoozePreset} from '../store/snoozePresets'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {CreateItemRow} from './CreateItemRow'
import {InboxRow} from './InboxRow'
import {mergeRows} from './mergeItems'
import {SelectionActions} from './SelectionActions'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxView} from './types'
import {EXIT_ANIMATION_MS, useUndoToast} from './useUndoToast'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface MergedListProps {
  reports: Record<string, SourceReport>
  /** The sources array as configured — also the merge tiebreak, see `mergeRows`. */
  order: string[]
  view: InboxView
  dismissals: Dismissals
  snoozes: Snoozes
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
  const {reports, order, view, dismissals, snoozes} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const rows = useMemo(() => mergeRows(reports, order, view), [reports, order, view])

  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [leavingKeys, setLeavingKeys] = useState<ReadonlySet<string>>(new Set())
  const showUndoToast = useUndoToast()

  // Derived from what's on screen, same reasoning every earlier version of
  // this list used: a row can disappear — someone else finishes it, the tab
  // changes — while selected, and deriving the selection from `rows` means
  // the action bar can never count one nobody can see.
  const selected = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.key)),
    [rows, selectedKeys],
  )

  const clearSelection = useCallback(() => setSelectedKeys([]), [])

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

      setBusy(true)
      try {
        const results = await Promise.allSettled(
          targets.map((row) => assignableSource.toUser(row.item, userId)),
        )
        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.error('[sanity-plugin-structure-inbox] could not assign item', result.reason)
          }
        })
        setSelectedKeys([])
      } finally {
        setBusy(false)
      }
    },
    [assignableSource, selected],
  )

  const reportsInOrder = order
    .map((name) => reports[name])
    .filter((r): r is SourceReport => Boolean(r))
  const creators = reportsInOrder.filter((r) => r.create)
  const errors = reportsInOrder.filter((r) => r.error)

  // A configured source that has not reported at all yet counts as loading,
  // the same as one that has reported `loading: true` — otherwise the first
  // render, before any `SourceFeed` effect has fired, flashes "All clear."
  const anyLoading = order.some((name) => !reports[name] || reports[name]?.loading)
  const isEmpty = rows.length === 0

  const describeSource = useCallback(
    (report: SourceReport | undefined): string | undefined => {
      if (!report) return undefined
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

      {view === 'open' &&
        creators.map((report) => (
          <CreateItemRow key={report.source.name} onCreate={(title) => report.create?.(title)} />
        ))}

      {selected.length > 0 && (
        <SelectionActions
          assignableUsers={view === 'open' ? assignableSource?.users : undefined}
          busy={busy}
          count={selected.length}
          onAssign={view === 'open' && assignableSource ? confirmAssign : undefined}
          onCancel={clearSelection}
          onConfirm={confirmSelection}
          onSnooze={view === 'open' ? confirmSnooze : undefined}
          resolves={selected.every((row) => Boolean(reports[row.sourceName]?.resolve))}
          view={view}
        />
      )}

      <Card border overflow="hidden" radius={3} shadow={0}>
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
            <Card borderBottom padding={2}>
              <Flex align="center">
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
              {rows.map((row) => {
                const report = reports[row.sourceName]
                return (
                  <InboxRow
                    done={view === 'done'}
                    item={row.item}
                    key={row.key}
                    leaving={leavingKeys.has(row.key)}
                    onAssess={report?.assess}
                    onlySelected={selected.length === 1 && selectedKeys.includes(row.key)}
                    onRemove={report?.remove}
                    onSelectedChange={(item: InboxItem, isSelected: boolean) =>
                      setSelectedKeys((current) =>
                        isSelected
                          ? [...current, row.key]
                          : current.filter((existing) => existing !== row.key),
                      )
                    }
                    selected={selectedKeys.includes(row.key)}
                    sourceLabel={describeSource(report)}
                  />
                )
              })}
            </Stack>
          </Stack>
        )}
      </Card>
    </Stack>
  )
}
