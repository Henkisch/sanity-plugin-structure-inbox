import {type InboxItem} from './types'

/**
 * The member `assigneeFilter` uses for "nobody" — a real assignee's own
 * label is never this exact string, so it's safe to use as a marker
 * alongside real labels in the same set. `assigneeFilter` and `typeFilter`
 * share one convention: an empty set means "no filter, show everything," not
 * "hide everything" — Jira-style multi-select, where checking several
 * people (or nobody plus several people) narrows to their union, and
 * checking none is the same as checking them all.
 */
export const ASSIGNEE_UNASSIGNED = '__unassigned__'

/**
 * Whether one row's item survives the current assignee/type filters —
 * shared between `MergedList.tsx` (filtering what it actually renders) and
 * `Inbox.tsx` (recomputing the headline count against the same rule, so
 * "N things waiting on you" never disagrees with what the filtered list
 * below it shows). Keeping one function is what keeps those two in sync;
 * duplicating the checks is exactly how they'd quietly drift apart.
 */
export function matchesInboxFilters(
  row: {sourceName: string; item: InboxItem},
  assigneeFilter: ReadonlySet<string>,
  typeFilter: ReadonlySet<string>,
): boolean {
  if (assigneeFilter.size > 0) {
    const key = row.item.assignee?.label ?? ASSIGNEE_UNASSIGNED
    if (!assigneeFilter.has(key)) return false
  }
  if (typeFilter.size > 0 && !typeFilter.has(row.sourceName)) return false
  return true
}
