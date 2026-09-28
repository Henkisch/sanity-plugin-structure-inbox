import {Box, Button, Flex, Text} from '@sanity/ui'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {allocate, MAX_LOADED_ROWS, PAGE_SIZE, SHOW_ALL_THRESHOLD} from './sources/pagedLimit'
import {type SourceReport} from './SourceFeed'

/** What the footer should say and offer, for the sources the list is currently showing. */
export interface MoreSummary {
  /** Open items counted but not loaded, across the sources the type filter lets through. */
  hidden: number
  /**
   * Whether "Showing X of Y" can be stated for the filtered list. False while
   * an assignee or language filter is active: an unloaded row has neither,
   * so how many of `hidden` would match is unknown.
   */
  countKnown: boolean
  /** How many rows the button will load: exact, since `plan` is what it asks for. */
  step: number
  /** `step` is everything that's left, so the button can say "Show all". */
  showAll: boolean
  /** What each source is asked for on click. Empty when nothing more can be loaded. */
  plan: {report: SourceReport; count: number}[]
  /** Hidden items remain, but the button can't load them (row budget spent, or every source at its ceiling). */
  atLimit: boolean
  loadingMore: boolean
}

/**
 * Pure, so the rules are testable without a render. The "hidden" count
 * mirrors `overflowMatchingFilters` (the headline) on purpose: the footer's
 * "of Y" and the headline are the same number, or the two would disagree on
 * screen.
 *
 * The step is list-wide, not per source: `PAGE_SIZE` split in proportion to
 * what each source has left, so the button's number is what actually loads
 * whatever the mix of sources. It never takes the list past
 * `MAX_LOADED_ROWS`, counted across every source, since every loaded row
 * is a rendered row.
 */
export function summarizeMore(
  reports: Record<string, SourceReport>,
  order: readonly string[],
  assigneeFilter: ReadonlySet<string>,
  typeFilter: ReadonlySet<string>,
  languageFilter: ReadonlySet<string>,
): MoreSummary {
  const all = order.map((name) => reports[name]).filter((report): report is SourceReport => Boolean(report))
  const candidates = all.filter((report) => typeFilter.size === 0 || typeFilter.has(report.source.name))
  const withMore = candidates.filter((report) => (report.overflow ?? 0) > 0)
  const hidden = withMore.reduce((total, report) => total + (report.overflow ?? 0), 0)

  const loaders = withMore.filter((report) => report.loadMore)
  const loadable = loaders.reduce((total, report) => total + (report.overflow ?? 0), 0)
  const loaded = all.reduce((total, report) => total + report.open.length, 0)
  const budget = Math.max(0, MAX_LOADED_ROWS - loaded)

  const showAll = loadable > 0 && loadable === hidden && loadable <= SHOW_ALL_THRESHOLD && loadable <= budget
  const step = showAll ? loadable : Math.min(PAGE_SIZE, loadable, budget)
  const shares = allocate(
    step,
    loaders.map((report) => report.overflow ?? 0),
  )
  const plan = loaders
    .map((report, index) => ({report, count: shares[index] ?? 0}))
    .filter(({count}) => count > 0)

  return {
    hidden,
    countKnown: assigneeFilter.size === 0 && languageFilter.size === 0,
    step,
    showAll,
    plan,
    atLimit: hidden > 0 && step === 0,
    loadingMore: candidates.some((report) => report.loadingMore),
  }
}

/**
 * The end of the Open list, when some source has more than it loaded:
 * progress ("Showing 19 of 63", per NN/g's load-more guidance: total, loaded,
 * and what remains) and a button that says exactly what it will do.
 *
 * One button for the whole list, not one per source: the list is merged and
 * sorted across sources, so a page from one source lands throughout it, not
 * under a per-source button, which would look like the click did nothing.
 */
export function LoadMoreFooter(props: {summary: MoreSummary; shown: number}) {
  const {summary, shown} = props
  const {hidden, countKnown, step, showAll, plan, atLimit, loadingMore} = summary
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  if (hidden === 0) return null

  return (
    <Box paddingX={2} paddingY={3}>
      <Flex align="center" gap={3} justify="space-between" wrap="wrap">
        <Box aria-live="polite" flex={1}>
          <Text muted size={1}>
            {countKnown
              ? t('inbox.more.progress', {shown, total: shown + hidden})
              : t('inbox.more.unknown')}
            {atLimit && !loadingMore ? ` ${t('inbox.more.atLimit')}` : null}
          </Text>
        </Box>
        {(plan.length > 0 || loadingMore) && (
          <Button
            disabled={loadingMore}
            fontSize={1}
            loading={loadingMore}
            mode="ghost"
            onClick={() => {
              for (const {report, count} of plan) report.loadMore?.(count)
            }}
            padding={2}
            text={showAll ? t('inbox.more.showAll', {count: step}) : t('inbox.more.show', {count: step})}
          />
        )}
      </Flex>
    </Box>
  )
}
