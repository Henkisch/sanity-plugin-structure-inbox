import {Box, Card, Stack, Text} from '@sanity/ui'
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

  // Derived from what's on screen, same reasoning every earlier version of
  // this list used: a row can disappear — someone else finishes it, the tab
  // changes — while selected, and deriving the selection from `rows` means
  // the action bar can never count one nobody can see.
  const selected = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.key)),
    [rows, selectedKeys],
  )

  const clearSelection = useCallback(() => setSelectedKeys([]), [])

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

      results.forEach((result, index) => {
        const row = targets[index]
        if (result.status === 'fulfilled') dismissals.dismiss(row.sourceName, row.item.id)
        else console.error('[sanity-plugin-structure-inbox] could not resolve item', result.reason)
      })

      setSelectedKeys([])
    } finally {
      setBusy(false)
    }
  }, [view, selected, reports, dismissals, snoozes])

  /** Snoozing is a plugin-level capability, not a per-source one — every item can be, regardless of where it came from. */
  const confirmSnooze = useCallback(
    (preset: SnoozePreset) => {
      const until = resolveSnoozeUntil(preset)
      for (const row of selected) snoozes.snooze(row.sourceName, row.item.id, until)
      setSelectedKeys([])
    },
    [selected, snoozes],
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
          <Stack gap={1} padding={1}>
            {rows.map((row) => {
              const report = reports[row.sourceName]
              return (
                <InboxRow
                  done={view === 'done'}
                  item={row.item}
                  key={row.key}
                  onAssess={report?.assess}
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
        )}
      </Card>
    </Stack>
  )
}
