import {Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useId} from 'react'
import {useTranslation} from 'sanity'
import {useRouter} from 'sanity/router'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {RelativeTime} from './RelativeTime'
import {type InboxItem} from './types'

interface InboxRowProps {
  item: InboxItem
  /** Aside rows: tighter, without the leading icon and the Open button. */
  compact?: boolean
  /** Already ticked off. Only ever rendered while "Show done" is on. */
  done?: boolean
  selected: boolean
  onSelectedChange: (item: InboxItem, selected: boolean) => void
}

export function InboxRow(props: InboxRowProps) {
  const {item, compact = false, done = false, selected, onSelectedChange} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const {navigateIntent} = useRouter()
  const labelId = useId()

  const handleOpen = useCallback(() => {
    if (!item.intent) return
    navigateIntent(item.intent.type, item.intent.params)
  }, [item.intent, navigateIntent])

  // Checking a box marks the row, it does not act on it. Which action follows
  // is the editor's next decision, offered once something is selected — the
  // same order a mail client puts them in, and the reason a tick that silently
  // completed things felt wrong.
  const handleSelect = useCallback(
    () => onSelectedChange(item, !selected),
    [item, onSelectedChange, selected],
  )

  const Icon = item.icon
  // A done row drops its own tone: the point of showing it is that it is
  // finished, and a caution-coloured finished row still reads as urgent.
  const tone = done || item.tone === 'default' ? undefined : item.tone

  const checkbox = (
    <Flex align="center" paddingLeft={1} paddingRight={compact ? 1 : 2}>
      <Checkbox
        aria-labelledby={labelId}
        checked={selected}
        onChange={handleSelect}
        title={t('selection.select')}
      />
    </Flex>
  )

  const label = (
    <Stack flex={1} gap={2}>
      <Text
        id={labelId}
        muted={done}
        size={1}
        textOverflow="ellipsis"
        weight={compact ? undefined : 'medium'}
      >
        {item.title}
      </Text>
      {(item.subtitle || item.timestamp) && (
        <Text muted size={0} textOverflow="ellipsis">
          {item.subtitle}
          {item.subtitle && item.timestamp ? ' · ' : ''}
          {item.timestamp && <RelativeTime timestamp={item.timestamp} />}
        </Text>
      )}
    </Stack>
  )

  if (compact) {
    return (
      <Card padding={2} radius={2} tone={selected ? 'primary' : tone}>
        <Flex align="center" gap={1}>
          {checkbox}
          <Box flex={1}>{label}</Box>
        </Flex>
      </Card>
    )
  }

  return (
    <Card padding={2} radius={2} tone={selected ? 'primary' : tone}>
      <Flex align="center" gap={2}>
        {checkbox}

        <Box flex={1}>
          <Flex align="center" gap={2}>
            {Icon && (
              <Text muted size={1}>
                <Icon />
              </Text>
            )}
            {label}
          </Flex>
        </Box>

        {item.intent && !done && (
          <Button
            fontSize={1}
            mode="bleed"
            onClick={handleOpen}
            padding={2}
            text={t('item.open')}
          />
        )}
      </Flex>
    </Card>
  )
}
