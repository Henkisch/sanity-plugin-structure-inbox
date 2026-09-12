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
import {type ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useDismissals} from '../store/useDismissals'
import {useSnoozes} from '../store/useSnoozes'
import {SectionCard} from '../ui/SectionCard'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'
import {StatusDot} from '../ui/StatusDot'
import {InboxSection} from './InboxSection'
import {MergedList} from './MergedList'
import {SourceFeed, type SourceReport} from './SourceFeed'
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
const SNOOZED_TAB_ID = 'structure-inbox-snoozed'
const PANEL_ID = 'structure-inbox-panel'

/**
 * A no-op: the boundary below already logs and renders the fallback card, and
 * nothing else in the pane needs to react to one source having thrown.
 */
function ignoreCaughtError(): void {
  // Intentionally empty.
}

interface BoundedSectionProps {
  source: InboxSource
  compact?: boolean
  dismissals: ReturnType<typeof useDismissals>
  snoozes: ReturnType<typeof useSnoozes>
  onCount: (sourceName: string, count: number) => void
  onVisibleCount?: (sourceName: string, count: number) => void
  view: InboxView
}

/**
 * One aside source, contained.
 *
 * The boundary sits outside `InboxSection` — not inside it, and not inside
 * `SectionCard` — because `InboxSection` is what calls `source.useItems()`.
 * A hook that throws does so while `InboxSection` is rendering, above any
 * boundary that component itself renders, so the boundary has to be a layer
 * further out to catch it. If `useItems()` ever moves, the boundary has to
 * move with it.
 *
 * Only ever used for `aside` sources now: `main` sources render through
 * `BoundedSourceFeed`/`MergedList` instead, so their items merge into one
 * list rather than each keeping its own card. Aside stays boxed and
 * per-source — it's ambient context, not something to clear.
 */
/**
 * Exported for `Inbox.test.tsx`: it can render this directly without also
 * mounting `useDismissals`' `useClient`, which needs a full Studio source
 * context that a unit test for this boundary should not have to carry.
 */
export function BoundedSection(props: BoundedSectionProps) {
  const {source, compact, dismissals, snoozes, onCount, onVisibleCount, view} = props

  const renderFallback = useCallback(
    (error: Error): ReactNode => (
      <SectionCard error={error} icon={source.icon} title={source.title}>
        {null}
      </SectionCard>
    ),
    [source],
  )

  return (
    <SectionErrorBoundary fallback={renderFallback} onCatch={ignoreCaughtError}>
      <InboxSection
        compact={compact}
        dismissals={dismissals}
        onCount={onCount}
        onVisibleCount={onVisibleCount}
        snoozes={snoozes}
        source={source}
        view={view}
      />
    </SectionErrorBoundary>
  )
}

interface BoundedSourceFeedProps {
  source: InboxSource
  dismissals: ReturnType<typeof useDismissals>
  snoozes: ReturnType<typeof useSnoozes>
  now: number
  onReport: (sourceName: string, report: SourceReport) => void
}

/**
 * One main source, contained — the `SourceFeed` equivalent of `BoundedSection`.
 *
 * `SourceFeed` renders nothing itself, so there is no fallback UI to draw
 * here: a throw is instead turned into an error report (`onReport`, same
 * channel a healthy source reports through), and `MergedList` is what shows
 * it — as a small card of its own, not a whole section's worth of chrome.
 *
 * Exported for the same reason `BoundedSection` is: a unit test can mount
 * this directly without a full Studio source context.
 */
export function BoundedSourceFeed(props: BoundedSourceFeedProps) {
  const {source, dismissals, snoozes, now, onReport} = props

  const handleCatch = useCallback(
    (error: Error) => {
      onReport(source.name, {source, error, open: [], done: [], snoozed: []})
    },
    [source, onReport],
  )

  return (
    <SectionErrorBoundary fallback={null} onCatch={handleCatch}>
      <SourceFeed
        dismissals={dismissals}
        now={now}
        onReport={onReport}
        snoozes={snoozes}
        source={source}
      />
    </SectionErrorBoundary>
  )
}

export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dismissals = useDismissals()
  const snoozes = useSnoozes()
  const [view, setView] = useState<InboxView>('open')

  // A snoozed item wakes on its own once `until` passes — see the identical
  // reasoning `InboxSection` used to carry itself, now shared by every main
  // source's feed so they all split open/snoozed against the same instant.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const showOpen = useCallback(() => setView('open'), [])
  const showDone = useCallback(() => setView('done'), [])
  const showSnoozed = useCallback(() => setView('snoozed'), [])

  const [reports, setReports] = useState<Record<string, SourceReport>>({})
  const handleReport = useCallback((sourceName: string, report: SourceReport) => {
    setReports((current) => ({...current, [sourceName]: report}))
  }, [])

  // Aside sources still report an open count the old way; nothing reads it
  // since the headline below is computed from `reports` instead, but
  // `InboxSection` requires the prop.
  const ignoreCount = useCallback(() => {}, [])

  const [asideVisibleCounts, setAsideVisibleCounts] = useState<Record<string, number>>({})
  const handleAsideVisibleCount = useCallback((sourceName: string, count: number) => {
    setAsideVisibleCounts((current) =>
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

  const mainOrder = useMemo(() => main.map((source) => source.name), [main])

  // Only the main column counts toward the headline. The aside is context —
  // "three releases are scheduled" is not three things asking for your
  // attention, and folding it in would make the number cry wolf.
  const openCount = useMemo(
    () => mainOrder.reduce((total, name) => total + (reports[name]?.open.length ?? 0), 0),
    [reports, mainOrder],
  )

  // The aside column is ambient context, not something to clear — an empty
  // one showing "All clear." earns it a whole extra column for a permanent
  // non-event. Rendered only once something in it is actually worth a look;
  // `undefined` (nothing reported yet) counts as "might have content" so the
  // column doesn't flash away and back on first load.
  const asideHasContent = aside.some((source) => (asideVisibleCounts[source.name] ?? 1) > 0)

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
    <Stack>
      {/*
       * Edge-to-edge and bordered, like every other pane's header — the flat
       * title bar Sanity renders above this from the pane's own `.title()`
       * carries only the static "Inbox" label, so without a border of its own
       * this is where the pane actually reads as content that starts. Giving
       * it the same bounded-header treatment as `SectionCard`'s title row
       * below is what makes the two feel like one pane instead of a floating
       * page followed by a list of cards.
       */}
      <Card borderBottom padding={4}>
        <Stack gap={4}>
          <Flex align="center" gap={3}>
            {/* Pulsing amber while something needs a look; a calm, static
                green once it doesn't — pulsing green would read as urgent,
                which contradicts "nothing waiting on you". */}
            <StatusDot tone={openCount > 0 ? 'attention' : 'clear'} />
            <Heading size={1}>
              {openCount === 0 ? t('inbox.allClear') : t('inbox.waiting', {count: openCount})}
            </Heading>
          </Flex>

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
              <Tab
                aria-controls={PANEL_ID}
                fontSize={1}
                id={SNOOZED_TAB_ID}
                label={t('tab.snoozed')}
                onClick={showSnoozed}
                selected={view === 'snoozed'}
              />
            </TabList>
          </Flex>
        </Stack>
      </Card>

      {main.map((source) => (
        <BoundedSourceFeed
          dismissals={dismissals}
          key={source.name}
          now={now}
          onReport={handleReport}
          snoozes={snoozes}
          source={source}
        />
      ))}

      <Box padding={4}>
        <Container width={4}>
          <TabPanel
            aria-labelledby={
              view === 'open' ? OPEN_TAB_ID : view === 'done' ? DONE_TAB_ID : SNOOZED_TAB_ID
            }
            id={PANEL_ID}
          >
            <Grid gap={4} gridTemplateColumns={COLUMNS}>
              <Box gridColumn={asideHasContent ? [1, 1, 1, 2] : COLUMNS}>
                <MergedList
                  dismissals={dismissals}
                  order={mainOrder}
                  reports={reports}
                  snoozes={snoozes}
                  view={view}
                />
              </Box>

              {asideHasContent && (
                <Box gridColumn={1}>
                  <Stack gap={3}>
                    {aside.map((source) => (
                      <BoundedSection
                        compact
                        dismissals={dismissals}
                        key={source.name}
                        onCount={ignoreCount}
                        onVisibleCount={handleAsideVisibleCount}
                        snoozes={snoozes}
                        source={source}
                        view={view}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Grid>
          </TabPanel>
        </Container>
      </Box>
    </Stack>
  )
}
