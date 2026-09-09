import {
  Box,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Text,
} from '@sanity/ui'
import {useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useDismissals} from '../store/useDismissals'
import {InboxSection} from './InboxSection'
import {type InboxSource, type InboxView} from './types'

interface InboxProps {
  sources: InboxSource[]
}

/**
 * Three columns, so `main` can take two thirds and `aside` one. Collapses to a
 * single stacked column below the widest breakpoints, where a sidebar would be
 * a sliver.
 */
const COLUMNS = [1, 1, 1, 3]

const OPEN_TAB_ID = 'structure-inbox-open'
const DONE_TAB_ID = 'structure-inbox-done'
const PANEL_ID = 'structure-inbox-panel'

export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dismissals = useDismissals()
  const [view, setView] = useState<InboxView>('open')
  const [counts, setCounts] = useState<Record<string, number>>({})

  const showOpen = useCallback(() => setView('open'), [])
  const showDone = useCallback(() => setView('done'), [])

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
          <Stack gap={4}>
            <Stack gap={3}>
              <Heading size={1}>
                {openCount === 0 ? t('inbox.allClear') : t('inbox.waiting', {count: openCount})}
              </Heading>
              <Text muted size={1}>
                {t('inbox.description')}
              </Text>
            </Stack>

            {/* Left-aligned under the heading rather than off at the right
                edge: at this width the tabs were a screen away from the list
                they filter. */}
            <Flex>
              <TabList gap={1}>
                <Tab
                  aria-controls={PANEL_ID}
                  fontSize={1}
                  id={OPEN_TAB_ID}
                  label={t('tab.open')}
                  onClick={showOpen}
                  selected={view === 'open'}
                />
                <Tab
                  aria-controls={PANEL_ID}
                  fontSize={1}
                  id={DONE_TAB_ID}
                  label={t('tab.done')}
                  onClick={showDone}
                  selected={view === 'done'}
                />
              </TabList>
            </Flex>
          </Stack>

          <TabPanel aria-labelledby={view === 'open' ? OPEN_TAB_ID : DONE_TAB_ID} id={PANEL_ID}>
            <Grid gap={4} gridTemplateColumns={COLUMNS}>
              <Box gridColumn={aside.length > 0 ? [1, 1, 1, 2] : COLUMNS}>
                <Stack gap={3}>
                  {main.map((source) => (
                    <InboxSection
                      dismissals={dismissals}
                      key={source.name}
                      onCount={handleCount}
                      source={source}
                      view={view}
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
                        source={source}
                        view={view}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Grid>
          </TabPanel>
        </Stack>
      </Container>
    </Box>
  )
}
