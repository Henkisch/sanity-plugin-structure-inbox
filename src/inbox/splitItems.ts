import {isSnoozed, type SnoozeState} from '../store/snoozes'
import {type InboxItem} from './types'

export interface SplitItems {
  open: InboxItem[]
  cleared: InboxItem[]
  snoozed: InboxItem[]
}

/**
 * Splits one source's items into open/cleared/snoozed — purely from each
 * item's own data, never from per-editor dismissal state. `InboxItem.cleared`
 * is only ever set by a source that can verify real resolution (a task's own
 * `status`, say); a source with no way to verify that never sets it, so its
 * items are only ever open or snoozed here — being "acknowledged" doesn't
 * move an item out of open, see `useDismissals`.
 *
 * Cleared wins over snoozed: an item Sanity itself confirms is resolved has
 * no need to also be asleep.
 */
export function splitItems(
  items: InboxItem[],
  sourceName: string,
  snoozes: SnoozeState,
  now: number,
): SplitItems {
  const open: InboxItem[] = []
  const cleared: InboxItem[] = []
  const snoozed: InboxItem[] = []

  for (const item of items) {
    if (item.cleared) {
      cleared.push(item)
    } else if (isSnoozed(snoozes, sourceName, item.id, now, item.changedAt)) {
      snoozed.push(item)
    } else {
      open.push(item)
    }
  }

  return {open, cleared, snoozed}
}
