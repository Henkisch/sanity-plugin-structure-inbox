import {isDismissed, type DismissalState} from '../store/dismissals'
import {isSnoozed, type SnoozeState} from '../store/snoozes'
import {type InboxItem} from './types'

export interface SplitItems {
  open: InboxItem[]
  done: InboxItem[]
  snoozed: InboxItem[]
}

/**
 * Splits one source's items into open/done/snoozed.
 *
 * Done wins over snoozed: a permanently finished item has no need to also be
 * asleep, so a dismissal is checked first and a snooze only decides between
 * what's left. Shared by every source feed — `InboxSection` (aside) and
 * `SourceFeed` (main) alike — so the three-way split can't drift between the
 * two rendering paths.
 */
export function splitItems(
  items: InboxItem[],
  sourceName: string,
  dismissals: DismissalState,
  snoozes: SnoozeState,
  now: number,
): SplitItems {
  const open: InboxItem[] = []
  const done: InboxItem[] = []
  const snoozed: InboxItem[] = []

  for (const item of items) {
    if (isDismissed(dismissals, sourceName, item.id, item.changedAt)) {
      done.push(item)
    } else if (isSnoozed(snoozes, sourceName, item.id, now, item.changedAt)) {
      snoozed.push(item)
    } else {
      open.push(item)
    }
  }

  return {open, done, snoozed}
}
