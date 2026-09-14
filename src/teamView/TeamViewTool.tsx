import {Avatar, Box, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useMemo} from 'react'
import {
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {groupByAssignee} from '../inbox/groupByAssignee'
import {optionalHook} from '../inbox/sources/capability'
import {type InboxSource} from '../inbox/types'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it — see `unpublishedDrafts.ts`. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

export interface TeamViewToolOptions {
  sources: InboxSource[]
  title: string
}

/**
 * "Who's sitting on what" — every configured source's currently-open items,
 * grouped by assignee instead of by tone/timestamp. Read-only: no
 * resolve/assign/snooze here (see `structureInboxTeamView`'s own doc
 * comment for why).
 *
 * Deliberately reads each source's `useItems()` directly rather than
 * through `SourceFeed.tsx`/`splitItems()`/`useDismissals()` — this view
 * must not apply any one editor's *personal* dismissal state, since that
 * would hide still-outstanding work from a lead asking what the whole team
 * is sitting on.
 */
export function createTeamViewTool(options: TeamViewToolOptions) {
  const {sources, title} = options

  return function TeamViewTool() {
    const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})

    // One `useItems()` call per configured source — safe only because
    // `sources` is a fixed array from `createTeamViewTool`'s own closure,
    // identical length/order on every render (a plugin config value, never
    // state) — see this file's own note in `plans/018-team-view-production.md`
    // before making `sources` any more dynamic than that.
    const results = sources.map((source) => source.useItems())

    const items = useMemo(() => results.flatMap((result) => result.items), [results])
    const loading = results.some((result) => result.loading)
    const error = results.find((result) => result.error)?.error

    const knownAssignees = useMemo(
      () =>
        (assignable ?? [])
          .filter((user) => user.granted)
          .map((user) => ({
            label: user.displayName || user.email || user.id,
            imageUrl: user.imageUrl,
          })),
      [assignable],
    )

    const groups = useMemo(() => groupByAssignee(items, knownAssignees), [items, knownAssignees])

    return (
      <Box padding={4}>
        <Stack gap={4}>
          <Heading size={2}>{title}</Heading>

          {loading && <Text size={1}>Loading…</Text>}
          {error && (
            <Card padding={3} radius={2} tone="critical">
              <Text size={1}>{error.message}</Text>
            </Card>
          )}
          {!loading && !error && groups.length === 0 && (
            <Text size={1}>Nothing open right now.</Text>
          )}

          {groups.map((group) => (
            <Card key={group.assignee} padding={3} radius={2} shadow={1}>
              <Stack gap={3}>
                <Flex align="center" gap={2}>
                  <Avatar
                    initials={group.assignee === 'Unassigned' ? undefined : group.assignee}
                    size={0}
                    src={group.imageUrl}
                  />
                  <Text weight="semibold">
                    {group.assignee} ({group.items.length})
                  </Text>
                </Flex>
                {group.items.length > 0 && (
                  <Stack gap={2}>
                    {group.items.map((item) => (
                      <Text key={item.id} size={1}>
                        {item.title}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      </Box>
    )
  }
}
