import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxView} from './types'

export interface MergedRow {
  /** Unique across every source — an item id is only unique within its own source. */
  key: string
  sourceName: string
  item: InboxItem
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
 * Flattens every reporting source's items for one view into a single,
 * sorted list.
 *
 * `order` is the sources array as configured, and doubles as the tiebreak:
 * `rows` is built by walking it in sequence, and `Array.prototype.sort` is
 * stable, so two rows tied on both tone and timestamp keep the order their
 * sources were configured in rather than jumping around between renders.
 */
export function mergeRows(
  reports: Record<string, SourceReport>,
  order: string[],
  view: InboxView,
): MergedRow[] {
  const rows: MergedRow[] = []

  for (const sourceName of order) {
    const report = reports[sourceName]
    if (!report) continue

    const items =
      view === 'cleared' ? report.cleared : view === 'snoozed' ? report.snoozed : report.open

    for (const item of items) {
      rows.push({key: `${sourceName} ${item.id}`, sourceName, item})
    }
  }

  return rows.sort(compareMergedRows)
}
