import {Box, Card, Container, Flex, Stack, Text} from '@sanity/ui'
import {Button} from '@sanity/ui'
import {useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useDismissals} from '../store/useDismissals'
import {InboxSection} from './InboxSection'
import {type InboxSource} from './types'

interface InboxProps {
  sources: InboxSource[]
}

export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dismissals = useDismissals()
  const [showDismissed, setShowDismissed] = useState(false)

  const toggleDismissed = useCallback(() => setShowDismissed((shown) => !shown), [])

  if (sources.length === 0) {
    return (
      <Box padding={4}>
        <Container width={1}>
          <Card border padding={4} radius={3} tone="transparent">
            <Stack gap={3}>
              <Text size={1} weight="medium">
                {t('inbox.unconfigured.title')}
              </Text>
              <Text muted size={1}>
                {t('inbox.unconfigured.description')}
              </Text>
            </Stack>
          </Card>
        </Container>
      </Box>
    )
  }

  return (
    <Box padding={4}>
      <Container width={1}>
        <Stack gap={4}>
          <Flex align="center" gap={3}>
            <Box flex={1}>
              <Text muted size={1}>
                {t('inbox.description')}
              </Text>
            </Box>
            <Button
              fontSize={1}
              mode="bleed"
              onClick={toggleDismissed}
              padding={2}
              text={showDismissed ? t('inbox.hideDone') : t('inbox.showDone')}
            />
          </Flex>

          {sources.map((source) => (
            <InboxSection
              dismissals={dismissals}
              key={source.name}
              showDismissed={showDismissed}
              source={source}
            />
          ))}
        </Stack>
      </Container>
    </Box>
  )
}
