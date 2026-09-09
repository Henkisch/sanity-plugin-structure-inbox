import {Box, Button, Card, Container, Flex, Grid, Heading, Stack, Text} from '@sanity/ui'
import {useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useDismissals} from '../store/useDismissals'
import {InboxSection} from './InboxSection'
import {type InboxSource} from './types'

interface InboxProps {
  sources: InboxSource[]
}

/**
 * Three columns, so `main` can take two thirds and `aside` one. Collapses to a
 * single stacked column below the widest breakpoints, where a sidebar would be
 * a sliver.
 */
const COLUMNS = [1, 1, 1, 3]

export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dismissals = useDismissals()
  const [showDone, setShowDone] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})

  const toggleDone = useCallback(() => setShowDone((shown) => !shown), [])

  const handleCount = useCallback((sourceName: string, count: number) => {
    setCounts((current) =>
      current[sourceName] === count ? current : {...current, [sourceName]: count},
    )
  }, [])

  const {main, aside} = useMemo(
    () => ({
      main: sources.filter((source) => (source.placement ?? 'main') === 'main'),
      aside: sources.filter((source) => source.placement === 'aside'),
    }),
    [sources],
  )

  // Only the main column counts toward the headline. The aside is context —
  // "three releases are scheduled" is not three things asking for your
  // attention, and folding it in would make the number cry wolf.
  const openCount = useMemo(
    () => main.reduce((total, source) => total + (counts[source.name] ?? 0), 0),
    [counts, main],
  )

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
      <Container width={4}>
        <Stack gap={4}>
          <Flex align="flex-end" gap={3}>
            <Stack flex={1} gap={3}>
              <Heading size={1}>
                {openCount === 0 ? t('inbox.allClear') : t('inbox.waiting', {count: openCount})}
              </Heading>
              <Text muted size={1}>
                {t('inbox.description')}
              </Text>
            </Stack>
            <Button
              fontSize={1}
              mode="bleed"
              onClick={toggleDone}
              padding={2}
              text={showDone ? t('inbox.hideDone') : t('inbox.showDone')}
            />
          </Flex>

          <Grid gap={4} gridTemplateColumns={COLUMNS}>
            <Box gridColumn={aside.length > 0 ? [1, 1, 1, 2] : COLUMNS}>
              <Stack gap={3}>
                {main.map((source) => (
                  <InboxSection
                    dismissals={dismissals}
                    key={source.name}
                    onCount={handleCount}
                    showDone={showDone}
                    source={source}
                  />
                ))}
              </Stack>
            </Box>

            {aside.length > 0 && (
              <Box gridColumn={1}>
                <Stack gap={3}>
                  {aside.map((source) => (
                    <InboxSection
                      compact
                      dismissals={dismissals}
                      key={source.name}
                      onCount={handleCount}
                      showDone={showDone}
                      source={source}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Grid>
        </Stack>
      </Container>
    </Box>
  )
}
