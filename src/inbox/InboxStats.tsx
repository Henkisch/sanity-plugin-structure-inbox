import {SparklesIcon} from '@sanity/icons/Sparkles'
import {Avatar, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {useMemo} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {initials, UnassignedAvatar} from './InboxRow'
import {type MergedRow} from './mergeItems'
import {type SuggestTodosState} from './types'

/** Rows whose source offers `assign` (so "unassigned" is a meaningful state) but nobody's on them. */
export function countUnassigned(assignableRows: readonly MergedRow[]): number {
  return assignableRows.filter((row) => !row.item.assignee).length
}

export interface AssigneeLoad {
  id: string
  label: string
  imageUrl?: string
  count: number
}

/**
 * Every distinct assignee across `rows`, with how many open items each has,
 * busiest first. Keyed by id, not label: two project members can share a
 * display name (a real case, not a hypothetical one), and keying on the
 * text they happen to render as would silently merge their counts.
 */
export function groupByAssigneeLoad(rows: readonly MergedRow[]): AssigneeLoad[] {
  const byId = new Map<string, AssigneeLoad>()

  for (const row of rows) {
    const assignee = row.item.assignee
    if (!assignee) continue

    const existing = byId.get(assignee.id)
    if (existing) existing.count += 1
    else byId.set(assignee.id, {id: assignee.id, label: assignee.label, imageUrl: assignee.imageUrl, count: 1})
  }

  return [...byId.values()].sort((a, b) => b.count - a.count)
}

interface InboxStatsProps {
  /** Every open row, across every main source — unfiltered, regardless of the filter bar above the list. */
  openRows: MergedRow[]
  /** `openRows`, restricted to sources that offer `assign` — the only ones "unassigned" means anything for. */
  assignableRows: MergedRow[]
  /**
   * Runs `Inbox.tsx`'s own pane-level suggestion read and renders the result
   * right here, unlike "Summarize" (a full paragraph, shown in its own card
   * above the list — too wide for this column's own comfort). A short list
   * of concrete todos with an Add each fits this card's own glanceable
   * rhythm instead. Omit (when no `todos` source is configured to add one
   * into) to leave this card stats-only.
   */
  onSuggestTodos?: () => void
  /** Adds one suggestion (by index into `suggestions.items`) to the editor's own todo list. */
  onAddSuggestion?: (index: number) => void
  /** Drops one suggestion (by index) without adding it — nothing is persisted either way. */
  onDismissSuggestion?: (index: number) => void
  suggestions?: SuggestTodosState
}

/**
 * A persistent "are we on top of our content?" summary — the aside column's
 * own content now that it's always visible, not just whenever an `aside`
 * source (Releases, say) happens to have something to show.
 *
 * Deliberately unfiltered: this reads `openRows`/`assignableRows` straight,
 * never the assignee/type filter state `Inbox.tsx` also owns. The filter
 * bar narrows what one person is looking at right now; this card's job is
 * the whole-team picture underneath that, so the two stay independent.
 */
export function InboxStats(props: InboxStatsProps) {
  const {
    openRows,
    assignableRows,
    onSuggestTodos,
    onAddSuggestion,
    onDismissSuggestion,
    suggestions = {status: 'idle'},
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const unassignedCount = useMemo(() => countUnassigned(assignableRows), [assignableRows])
  const assigneeLoad = useMemo(() => groupByAssigneeLoad(openRows), [openRows])

  return (
    <Card border overflow="hidden" radius={3} shadow={0}>
      {/* Matches `SectionCard`'s own header treatment, not the component
          itself — `SectionCard` is built around one source's items with a
          retry-on-error path this card has no use for; a plain header plus
          a `Stack` of stat rows is simpler here than bending that component
          to fit. */}
      <Card
        borderBottom
        paddingX={3}
        paddingY={3}
        radius={0}
        style={{alignItems: 'center', display: 'flex', minHeight: 54}}
        tone="transparent"
      >
        <Flex align="center" gap={3} paddingLeft={2}>
          <Text size={1} weight="semibold">
            {t('stats.title')}
          </Text>
        </Flex>
      </Card>

      <Stack gap={4} padding={4}>
        {(assigneeLoad.length > 0 || unassignedCount > 0) && (
          <Stack gap={2}>
            <Text muted size={0} weight="semibold">
              {t('stats.load.title')}
            </Text>
            <Stack gap={2}>
              {/* Unassigned first, not a separate stat above this list —
                  it's one more bucket of open items, same as any named
                  person's, so it belongs where the others are counted, not
                  singled out on its own line. */}
              {unassignedCount > 0 && (
                <Flex align="center" gap={2} justify="space-between">
                  <Flex align="center" gap={2}>
                    <UnassignedAvatar size={0} />
                    <Text size={1}>{t('assignee.unassigned')}</Text>
                  </Flex>
                  <Text muted size={1}>
                    {unassignedCount}
                  </Text>
                </Flex>
              )}
              {assigneeLoad.map((person) => (
                <Flex align="center" gap={2} justify="space-between" key={person.id}>
                  <Flex align="center" gap={2}>
                    <Avatar initials={initials(person.label)} size={0} src={person.imageUrl} />
                    <Text size={1}>{person.label}</Text>
                  </Flex>
                  <Text muted size={1}>
                    {person.count}
                  </Text>
                </Flex>
              ))}
            </Stack>
          </Stack>
        )}

        {onSuggestTodos && (
          <Stack gap={3}>
            {suggestions.status !== 'done' && (
              // `justify="flex-start"`, not left to the `Stack`'s own
              // default: a bare `Button` here rendered centered under the
              // stats above it, reading as its own disconnected element
              // rather than one more row in this card. `marginLeft` alone
              // (an earlier attempt) offset the button's own padding but did
              // nothing about the centering itself.
              <Flex justify="flex-start" style={{marginLeft: -8}}>
                <Button
                  disabled={suggestions.status === 'loading'}
                  fontSize={1}
                  icon={SparklesIcon}
                  mode="bleed"
                  onClick={onSuggestTodos}
                  padding={2}
                  text={suggestions.status === 'loading' ? t('todoSuggest.loading') : t('overview.askAi')}
                />
              </Flex>
            )}

            {suggestions.status === 'error' && (
              <Text muted size={1}>
                {t('todoSuggest.error')}
              </Text>
            )}

            {suggestions.status === 'done' && suggestions.items.length === 0 && (
              <Text muted size={1}>
                {t('todoSuggest.none')}
              </Text>
            )}

            {suggestions.status === 'done' && suggestions.items.length > 0 && (
              <Stack gap={3}>
                {suggestions.items.map((suggestion, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- stable per render: a suggestion is only ever added or dismissed, both of which remove it from `items` outright rather than reordering around it.
                  <Stack gap={2} key={index}>
                    <Flex align="flex-start" gap={2}>
                      <Text muted size={0}>
                        <SparklesIcon />
                      </Text>
                      <Stack flex={1} gap={1}>
                        <Text size={1} weight="semibold">
                          {suggestion.title}
                        </Text>
                        <Text muted size={1}>
                          {suggestion.reason}
                        </Text>
                      </Stack>
                    </Flex>
                    <Flex gap={2} paddingLeft={4}>
                      <Button
                        fontSize={0}
                        mode="bleed"
                        onClick={() => onAddSuggestion?.(index)}
                        padding={1}
                        text={t('todoSuggest.add')}
                        tone="primary"
                      />
                      <Button
                        fontSize={0}
                        mode="bleed"
                        onClick={() => onDismissSuggestion?.(index)}
                        padding={1}
                        text={t('todoSuggest.dismiss')}
                      />
                    </Flex>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
