import {type InboxItem} from './types'

export interface AssigneeGroup {
  /** A team member's display label, or `'Unassigned'`. */
  assignee: string
  imageUrl?: string
  items: InboxItem[]
}

/**
 * Groups items by `item.assignee`, seeding a bucket for every name in
 * `knownAssignees` even if it ends up empty — a team lead benefits from
 * seeing "nothing" next to someone's name as much as from a full bucket
 * (confirms the roster, and that nobody is silently overloaded while
 * someone else has nothing). `'Unassigned'` always sorts last: an assignee
 * bucket is the point of this view, an unowned pile is the leftover.
 */
export function groupByAssignee(
  items: readonly InboxItem[],
  knownAssignees: readonly {label: string; imageUrl?: string}[],
): AssigneeGroup[] {
  const byAssignee = new Map<string, AssigneeGroup>()

  for (const known of knownAssignees) {
    byAssignee.set(known.label, {assignee: known.label, imageUrl: known.imageUrl, items: []})
  }

  for (const item of items) {
    const key = item.assignee?.label ?? 'Unassigned'
    const existing = byAssignee.get(key)
    if (existing) existing.items.push(item)
    else byAssignee.set(key, {assignee: key, imageUrl: item.assignee?.imageUrl, items: [item]})
  }

  return [...byAssignee.values()].sort((a, b) => {
    if (a.assignee === 'Unassigned') return 1
    if (b.assignee === 'Unassigned') return -1
    return a.assignee.localeCompare(b.assignee)
  })
}
