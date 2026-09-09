import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useState} from 'react'
import {useTranslation} from 'sanity'
import {useRouter} from 'sanity/router'

import {STRUCTURE_HOME_NAMESPACE} from '../constants'
import {RelativeTime} from './RelativeTime'
import {type InboxItem} from './types'

interface InboxRowProps {
  item: InboxItem
  /** True when ticking completes the item at its source rather than only hiding it. */
  resolves: boolean
  onTick: (item: InboxItem) => Promise<void> | void
}

export function InboxRow(props: InboxRowProps) {
  const {item, resolves, onTick} = props
  const {t} = useTranslation(STRUCTURE_HOME_NAMESPACE)
  const {navigateIntent} = useRouter()
  const [busy, setBusy] = useState(false)

  const handleOpen = useCallback(() => {
    if (!item.intent) return
    navigateIntent(item.intent.type, item.intent.params)
  }, [item.intent, navigateIntent])

  const handleTick = useCallback(async () => {
    setBusy(true)
    try {
      await onTick(item)
    } finally {
      // The row usually unmounts on success, so this only matters when the tick
      // failed — in which case the editor needs the button back.
      setBusy(false)
    }
  }, [item, onTick])

  const Icon = item.icon

  return (
    <Card padding={2} radius={2} tone={item.tone === 'default' ? undefined : item.tone}>
      <Flex align="center" gap={2}>
        <Button
          disabled={busy}
          fontSize={1}
          icon={CheckmarkIcon}
          mode="bleed"
          onClick={handleTick}
          padding={2}
          text=""
          title={resolves ? t('item.resolve') : t('item.dismiss')}
          tone={resolves ? 'positive' : 'default'}
        />

        <Box flex={1}>
          <Flex align="center" gap={2}>
            {Icon && (
              <Text muted size={1}>
                <Icon />
              </Text>
            )}
            <Stack flex={1} gap={2}>
              <Text size={1} textOverflow="ellipsis" weight="medium">
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
          </Flex>
        </Box>

        {item.intent && (
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
