import {Box, Button, Flex, Text} from '@sanity/ui'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type SourceReport} from './SourceFeed'

/** What the footer should say and offer, for the sources the list is currently showing. */
export interface MoreSummary {
  /** Open items counted but not loaded, across the sources the type filter lets through. */
  hidden: number
  /**
   * Whether `hidden` can be stated as "N more" for the filtered list. False
   * while an assignee or language filter is active: an unloaded row has
   * neither, so how many of the `hidden` would match is unknown.
   */
  countKnown: boolean
  /** The sources that can load a further page right now. Empty once all are at their ceiling. */
  loaders: SourceReport[]
  loadingMore: boolean
}

/**
 * Pure, so the rules are testable without a render — see
 * `LoadMoreFooter.test.tsx`. Mirrors `overflowMatchingFilters` (the headline)
 * on purpose: the footer's "N more" and the headline's extra count are the
 * same number, or the two would disagree on screen.
 */
export function summarizeMore(
  reports: Record<string, SourceReport>,
  order: readonly string[],
  assigneeFilter: ReadonlySet<string>,
  typeFilter: ReadonlySet<string>,
  languageFilter: ReadonlySet<string>,
): MoreSummary {
  const candidates = order
    .map((name) => reports[name])
    .filter(
      (report): report is SourceReport =>
        Boolean(report) && (typeFilter.size === 0 || typeFilter.has(report.source.name)),
    )
  const withMore = candidates.filter((report) => (report.overflow ?? 0) > 0)
  return {
    hidden: withMore.reduce((total, report) => total + (report.overflow ?? 0), 0),
    countKnown: assigneeFilter.size === 0 && languageFilter.size === 0,
    loaders: withMore.filter((report) => report.loadMore),
    loadingMore: candidates.some((report) => report.loadingMore),
  }
}

/**
 * The end of the Open list, when some source has more than it loaded: how
 * many, and a "Show more" that asks each such source for its next page.
 *
 * One button for the whole list, not one per source: the list is merged and
 * sorted across sources, so a page from one source lands throughout it, not
 * under a per-source button — which would look like the click did nothing.
 */
export function LoadMoreFooter(props: {summary: MoreSummary}) {
  const {hidden, countKnown, loaders, loadingMore} = props.summary
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  if (hidden === 0) return null

  return (
    <Box paddingX={2} paddingY={3}>
      <Flex align="center" gap={3} justify="space-between" wrap="wrap">
        <Box aria-live="polite" flex={1}>
          <Text muted size={1}>
            {countKnown ? t('inbox.more.count', {count: hidden}) : t('inbox.more.unknown')}
            {loaders.length === 0 && !loadingMore ? ` ${t('inbox.more.atLimit')}` : null}
          </Text>
        </Box>
        {(loaders.length > 0 || loadingMore) && (
          <Button
            disabled={loadingMore}
            fontSize={1}
            loading={loadingMore}
            mode="ghost"
            onClick={() => {
              for (const report of loaders) report.loadMore?.()
            }}
            padding={2}
            text={t('inbox.more.show')}
          />
        )}
      </Flex>
    </Box>
  )
}
