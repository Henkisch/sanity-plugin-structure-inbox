import {UsersIcon} from '@sanity/icons/Users'
import {Avatar, Box, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useMemo} from 'react'
import {definePlugin} from 'sanity'
import {openTasks, unpublishedDrafts, type InboxItem} from 'sanity-plugin-structure-inbox'

/**
 * Plan 012 spike: does grouping "everyone"-audience inbox items by assignee
 * work with data this plugin already produces, without a new query?
 *
 * Deliberately a throwaway prototype, not shipped surface: lives only in
 * `test-studio`, reads two already-exported sources directly by calling their
 * `useItems()` hook in a plain component (the same thing `SourceFeed.tsx`
 * does for the real Inbox pane — see `src/inbox/SourceFeed.tsx:36`), and
 * renders no interactivity at all. See `plans/012-team-wide-view.md`,
 * "Findings (retry, against decd612)", for what this proved and what it did
 * not.
 */

interface Row {
  key: string
  sourceName: string
  item: InboxItem
}

function assigneeKey(item: InboxItem): string {
  return item.assignee?.label ?? 'Unassigned'
}

function TeamViewSpikeTool() {
  // Fresh instances are fine here — unlike the real plugin, this spike does
  // not need referential stability across renders, since nothing downstream
  // memoizes on the source object's identity.
  const draftsSource = useMemo(() => unpublishedDrafts({olderThanDays: 0}), [])
  const tasksSource = useMemo(() => openTasks({onlyMine: false}), [])

  const drafts = draftsSource.useItems()
  const tasks = tasksSource.useItems()

  const rows: Row[] = useMemo(
    () => [
      ...drafts.items.map((item): Row => ({key: `unpublishedDrafts ${item.id}`, sourceName: 'Draft', item})),
      ...tasks.items.map((item): Row => ({key: `openTasks ${item.id}`, sourceName: 'Task', item})),
    ],
    [drafts.items, tasks.items],
  )

  const groups = useMemo(() => {
    const byAssignee = new Map<string, Row[]>()
    for (const row of rows) {
      const key = assigneeKey(row.item)
      const existing = byAssignee.get(key)
      if (existing) existing.push(row)
      else byAssignee.set(key, [row])
    }
    // "Unassigned" last — an assignee bucket is the point of this view, an
    // unowned pile is the leftover.
    return [...byAssignee.entries()].sort(([a], [b]) => {
      if (a === 'Unassigned') return 1
      if (b === 'Unassigned') return -1
      return a.localeCompare(b)
    })
  }, [rows])

  const loading = drafts.loading || tasks.loading
  const error = drafts.error || tasks.error

  return (
    <Box padding={4}>
      <Stack gap={4}>
        <Heading size={2}>Team view (spike)</Heading>
        <Text size={1} muted>
          {"'everyone'"}-audience items from `unpublishedDrafts` and `openTasks({'{'}onlyMine:
          false{'}'})`, grouped by assignee. Read-only prototype for Plan 012 — no resolve, no
          assign, no snooze wired up.
        </Text>

        {loading && <Text size={1}>Loading…</Text>}
        {error && (
          <Card padding={3} tone="critical" radius={2}>
            <Text size={1}>{error.message}</Text>
          </Card>
        )}

        {!loading && !error && rows.length === 0 && <Text size={1}>Nothing open right now.</Text>}

        {groups.map(([assignee, groupRows]) => (
          <Card key={assignee} padding={3} radius={2} shadow={1}>
            <Stack gap={3}>
              <Flex align="center" gap={2}>
                <Avatar
                  size={0}
                  initials={assignee === 'Unassigned' ? undefined : assignee}
                  src={groupRows[0]?.item.assignee?.imageUrl}
                />
                <Text weight="semibold">
                  {assignee} ({groupRows.length})
                </Text>
              </Flex>
              <Stack gap={2}>
                {groupRows.map((row) => (
                  <Flex key={row.key} justify="space-between" gap={3}>
                    <Text size={1}>{row.item.title}</Text>
                    <Text size={1} muted>
                      {row.sourceName}
                    </Text>
                  </Flex>
                ))}
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Box>
  )
}

export const teamViewSpike = definePlugin({
  name: 'test-studio/team-view-spike',
  tools: (prev) => [
    ...prev,
    {
      name: 'teamViewSpike',
      title: 'Team View (spike)',
      icon: UsersIcon,
      component: TeamViewSpikeTool,
    },
  ],
})
