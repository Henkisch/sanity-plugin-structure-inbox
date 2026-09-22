import {isDismissed, type DismissalState} from '../store/dismissals'
import {type SnoozeState} from '../store/snoozes'
import {type SourceReport} from './SourceFeed'
import {splitItems} from './splitItems'
import {type InboxItem, type InboxView} from './types'

export interface MergedRow {
  /** Unique across every source — an item id is only unique within its own source. */
  key: string
  sourceName: string
  item: InboxItem
  /**
   * Only set in the Cleared view: whether this row left Open because its own
   * source confirmed real completion (`'source'`) or because an editor
   * manually cleared it (`'editor'`) — see `InboxSourceResult.acknowledgable`
   * and `useDismissals`. `undefined` in every other view, where the
   * distinction doesn't apply yet. Drives both the small "Confirmed"/"Cleared
   * by you" label in `MergedList.tsx` and which action actually reopens the
   * row (a source's own `reopen` for `'source'`, `dismissals.restore` for
   * `'editor'` — a manually-cleared row has no real resolution to undo).
   */
  clearedBy?: 'source' | 'editor'
  /**
   * Only set in the Cleared view: the real moment this row left Open — the
   * item's own `changedAt` for a real, source-confirmed completion (the best
   * proxy available; nothing records a separate "resolved at" moment), or the
   * dismissal's own timestamp for a manual clear, which is exact. Feeds
   * `InboxStats`' own "Cleared today" stat, so a manual clear counts on the
   * day it actually happened rather than the day the item's content last
   * changed (which can be long before it was ever cleared).
   */
  clearedAt?: string
}

const TONE_RANK: Record<string, number> = {critical: 0, caution: 1, primary: 2, default: 3}

function toneRank(item: InboxItem): number {
  return TONE_RANK[item.tone ?? 'default'] ?? 3
}

function parseTime(value: string | undefined): number {
  return value ? Date.parse(value) : NaN
}

/**
 * Orders rows the way an editor actually triages an inbox — most urgent
 * first, then longest-waiting first — never by which source an item happens
 * to come from.
 *
 * `tone` is the urgency signal a source already sets deliberately (see
 * `InboxItem.tone`'s own doc comment: "use sparingly"), so it decides first.
 * `timestamp` is what `InboxItem` itself documents as "used to order within
 * a group" — exactly this. An item with no timestamp sorts after one that
 * has any, rather than at an arbitrary position a missing date would
 * otherwise fall into.
 */
export function compareMergedRows(a: MergedRow, b: MergedRow): number {
  const toneDiff = toneRank(a.item) - toneRank(b.item)
  if (toneDiff !== 0) return toneDiff

  const timeA = parseTime(a.item.timestamp)
  const timeB = parseTime(b.item.timestamp)
  const validA = Number.isFinite(timeA)
  const validB = Number.isFinite(timeB)

  if (validA && validB) return timeA - timeB
  if (validA) return -1
  if (validB) return 1
  return 0
}

/**
 * Whether an otherwise-open item has been manually cleared by this editor —
 * the single definition of the dismissal axis that `splitItems` deliberately
 * knows nothing about (see its own doc comment).
 *
 * Deliberately the *only* place this rule is written down. Both numbers an
 * editor can see are derived from it: the pane's own open list (`mergeRows`
 * below, feeding `Inbox.tsx`'s headline) and the always-visible navbar badge
 * (`countOpenItems` below, feeding `useInboxOpenCount()`). They used to
 * compute openness independently, and drifted apart the moment this axis was
 * added to one of them — the pane said "3 things waiting" while the badge
 * still said "8". Anything that changes what "open" means belongs here, so
 * both keep agreeing by construction rather than by review.
 *
 * `acknowledgable` is the source's own opt-out (`todos`): a source that never
 * offered a manual clear has no dismissal to honour, so any entry on record
 * for one is ignored — matching the write side no longer offering a way to
 * create one. `undefined` means the default, which is "yes".
 */
export function isManuallyCleared(
  dismissals: DismissalState,
  sourceName: string,
  item: InboxItem,
  acknowledgable: boolean | undefined,
): boolean {
  return acknowledgable !== false && isDismissed(dismissals, sourceName, item.id, item.changedAt)
}

/**
 * How many of one source's items an editor still has waiting — the count
 * behind `InboxSource.useOpenCount`, and by construction the same number the
 * pane's own Open view would show for that source.
 *
 * The two filters run in the same order the pane runs them: `splitItems`
 * first (real, source-confirmed completion and snoozes, from each item's own
 * data), then the per-editor dismissal axis on top of what survived — exactly
 * `SourceFeed` handing `report.open` to `mergeRows`.
 */
export function countOpenItems(
  items: InboxItem[],
  sourceName: string,
  snoozes: SnoozeState,
  now: number,
  dismissals: DismissalState,
  acknowledgable?: boolean,
): number {
  const {open} = splitItems(items, sourceName, snoozes, now)
  return open.reduce(
    (total, item) =>
      isManuallyCleared(dismissals, sourceName, item, acknowledgable) ? total : total + 1,
    0,
  )
}

/**
 * Flattens every reporting source's items for one view into a single,
 * sorted list.
 *
 * `order` is the sources array as configured, and doubles as the tiebreak:
 * `rows` is built by walking it in sequence, and `Array.prototype.sort` is
 * stable, so two rows tied on both tone and timestamp keep the order their
 * sources were configured in rather than jumping around between renders.
 *
 * `dismissals` is what actually moves a row between Open and Cleared for a
 * source with no real `resolve` — `splitItems.ts` only ever knows about real,
 * source-confirmed completion, so a source like `unpublishedDrafts` (no
 * `resolve` at all) would otherwise have no way into Cleared whatsoever. A
 * non-stale dismissal (see `isDismissed`) on an otherwise-open item pulls it
 * out of Open and into Cleared here instead, tagged `clearedBy: 'editor'` so
 * the two kinds of "done" stay visibly distinct rather than silently merging.
 * A source that opted out of `acknowledgable` (`todos`) never gets this
 * treatment — any dismissal on record for one is ignored, the same as the
 * write side no longer offering a way to create one.
 */
export function mergeRows(
  reports: Record<string, SourceReport>,
  order: string[],
  view: InboxView,
  dismissals: DismissalState,
): MergedRow[] {
  const rows: MergedRow[] = []

  for (const sourceName of order) {
    const report = reports[sourceName]
    if (!report) continue

    if (view === 'snoozed') {
      for (const item of report.snoozed) {
        rows.push({key: `${sourceName} ${item.id}`, sourceName, item})
      }
      continue
    }

    for (const item of report.open) {
      const manuallyCleared = isManuallyCleared(dismissals, sourceName, item, report.acknowledgable)

      if (view === 'cleared') {
        if (manuallyCleared) {
          rows.push({
            key: `${sourceName} ${item.id}`,
            sourceName,
            item,
            clearedBy: 'editor',
            clearedAt: dismissals.dismissed[sourceName]?.[item.id],
          })
        }
      } else if (!manuallyCleared) {
        rows.push({key: `${sourceName} ${item.id}`, sourceName, item})
      }
    }

    if (view === 'cleared') {
      for (const item of report.cleared) {
        rows.push({
          key: `${sourceName} ${item.id}`,
          sourceName,
          item,
          clearedBy: 'source',
          clearedAt: item.changedAt,
        })
      }
    }
  }

  return rows.sort(compareMergedRows)
}
