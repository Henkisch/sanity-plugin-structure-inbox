import {Badge, Box, Stack, Text} from '@sanity/ui'
import {useCallback, useMemo} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {isDismissed} from '../store/dismissals'
import {type Dismissals} from '../store/useDismissals'
import {SectionCard} from '../ui/SectionCard'
import {InboxRow} from './InboxRow'
import {type InboxItem, type InboxSource} from './types'

interface InboxSectionProps {
  source: InboxSource
  dismissals: Dismissals
  showDismissed: boolean
}

/**
 * One source's group in the inbox.
 *
 * Each source gets its own component so its `useItems` hook has a stable call
 * position of its own. A single component looping over sources would break the
 * rules of hooks the moment a Studio's config changed.
 */
export function InboxSection(props: InboxSectionProps) {
  const {source, dismissals, showDismissed} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const {items, loading, error, resolve} = source.useItems()

  const visible = useMemo(
    () =>
      showDismissed
        ? items
        : items.filter((item) => !isDismissed(dismissals.state, source.name, item.id)),
    [items, dismissals.state, source.name, showDismissed],
  )

  const handleTick = useCallback(
    async (item: InboxItem) => {
      // Resolve first: if completing the item at its source fails, it should
      // stay in the inbox rather than quietly disappear from this editor's view
      // while remaining open for everyone else.
      if (resolve) await resolve(item)
      dismissals.dismiss(source.name, item.id)
    },
    [resolve, dismissals, source.name],
  )

  // A source that throws inside its hook is caught by `SectionCard`; one that
  // reports an error in its result is shown here.
  if (error) throw error

  return (
    <SectionCard
      badge={
        visible.length > 0 ? (
          <Badge fontSize={0} tone="default">
            {visible.length}
          </Badge>
        ) : undefined
      }
      icon={source.icon}
      title={source.title}
    >
      {loading && visible.length === 0 ? (
        <Box padding={3}>
          <Text muted size={1}>
            {t('source.loading')}
          </Text>
        </Box>
      ) : visible.length === 0 ? (
        <Box padding={3}>
          <Text muted size={1}>
            {t('source.empty')}
          </Text>
        </Box>
      ) : (
        <Stack gap={1} padding={1}>
          {visible.map((item) => (
            <InboxRow item={item} key={item.id} onTick={handleTick} resolves={Boolean(resolve)} />
          ))}
        </Stack>
      )}
    </SectionCard>
  )
}
