import {ArrowLeftIcon} from '@sanity/icons/ArrowLeft'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {useCallback, useEffect, useMemo, useRef} from 'react'
import {useTranslation} from 'sanity'
import {usePaneRouter, useStructureTool} from 'sanity/structure'
import {styled} from 'styled-components'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {Inbox} from '../inbox/Inbox'
import {type InboxSource, type InboxView} from '../inbox/types'
import {type StructureInboxConfig} from '../types'
import {SectionCard} from '../ui/SectionCard'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'
import {
  INBOX_ASSIGNEE_PARAM,
  INBOX_TYPE_PARAM,
  INBOX_VIEW_PARAM,
  parseInboxPaneParams,
} from './inboxPaneParams'

/**
 * Props the structure tool hands a `S.component()` pane. Only `options` matters
 * here — the rest (pane keys, selection state, split-view indexes) is chrome
 * the pane itself already handles.
 */
interface InboxPaneProps {
  options?: {
    sources?: InboxSource[]
    ask?: boolean
    summarize?: boolean
    suggestTodos?: boolean
    contentGaps?: StructureInboxConfig['contentGaps']
    context?: string
  }
}

/**
 * `UserComponentPaneContent` is the scroll container, so a bar rendered inside
 * it scrolls away with the rows — on a long inbox that puts the only way out
 * of the pane hundreds of rows up. Sticky keeps it where a pane header would
 * be without needing to be one.
 */
const StickyCard = styled(Card)`
  position: sticky;
  top: 0;
  z-index: 1;
`

/**
 * A back bar, rendered only when the structure tool is showing one pane at a
 * time.
 *
 * The Inbox pane has no title, and a titleless `S.component()` pane gets no
 * pane header from `UserComponentPane` at all — which is deliberate, because
 * on a wide layout the root list sits right beside the pane and a bar that
 * only repeats the word "Inbox" costs vertical space for nothing. Collapsed,
 * that same absence is a trap: the only visible pane is the last one, so with
 * no header there is no back button, and the rest of the structure cannot be
 * reached. Giving the node a title would fix the phone and regress every
 * desktop, so the bar lives here, behind the same `layoutCollapsed` flag the
 * tool uses for its own back buttons.
 *
 * Built by hand rather than with Sanity's `PaneHeader`, which is not part of
 * the public `sanity/structure` surface.
 */
function CollapsedBackBar() {
  const {layoutCollapsed} = useStructureTool()
  const {BackLink} = usePaneRouter()
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  // `BackLink` is undefined for the first pane, which is the one case where
  // there is nothing behind this one to go back to.
  if (!layoutCollapsed || !BackLink) return null

  return (
    <StickyCard borderBottom paddingX={2} paddingY={2}>
      <Flex align="center" gap={1}>
        <Button
          aria-label={t('inbox.back')}
          as={BackLink}
          data-as="a"
          icon={ArrowLeftIcon}
          mode="bleed"
        />
        <Box paddingX={1}>
          <Text size={1} weight="medium">
            {t('inbox.title')}
          </Text>
        </Box>
      </Flex>
    </StickyCard>
  )
}

function ignoreCaughtError(): void {}

/**
 * The last line of containment: anything `Inbox` throws that no inner
 * boundary caught becomes an error card inside this pane, instead of
 * unmounting the Structure tool around it — which is what a single
 * unrenderable row title did before rows had boundaries of their own.
 */
function PaneFallback(props: {error: Error; retry: (() => void) | undefined}) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  return (
    <Box padding={3}>
      <SectionCard error={props.error} onRetry={props.retry} title={t('inbox.title')}>
        {null}
      </SectionCard>
    </Box>
  )
}

function renderPaneFallback(error: Error, retry: (() => void) | undefined) {
  return <PaneFallback error={error} retry={retry} />
}

/**
 * The pane that fills the canvas editors land on.
 *
 * `UserComponentPaneContent` already provides full height and scrolling, so
 * this only has to render the inbox.
 */
export function InboxPane(props: InboxPaneProps) {
  const paneRouter = usePaneRouter()

  // `paneRouter` is rebuilt on virtually every router-state change anywhere
  // in the pane tree, not just this pane's own — same reasoning
  // `assetIssues.ts`'s `navigateUrlRef` doc comment gives for `useRouter()`.
  // Held in a ref so the callbacks below don't churn identity on an
  // unrelated re-render.
  const paneRouterRef = useRef(paneRouter)
  useEffect(() => {
    paneRouterRef.current = paneRouter
  }, [paneRouter])

  // Read once, to seed `Inbox`'s initial state — recomputing this on every
  // render is cheap and harmless, since only the *values themselves* matter
  // to `Inbox`'s lazy `useState` initializers, which read them exactly once.
  const initial = useMemo(() => parseInboxPaneParams(paneRouter.params), [paneRouter.params])

  const handleViewChange = useCallback((view: InboxView) => {
    const current = paneRouterRef.current
    current.setParams({
      ...current.params,
      [INBOX_VIEW_PARAM]: view === 'open' ? undefined : view,
    })
  }, [])

  const handleAssigneeFilterChange = useCallback((filter: ReadonlySet<string>) => {
    const current = paneRouterRef.current
    current.setParams({
      ...current.params,
      [INBOX_ASSIGNEE_PARAM]:
        filter.size === 0 ? undefined : [...filter].map(encodeURIComponent).join(','),
    })
  }, [])

  const handleTypeFilterChange = useCallback((filter: ReadonlySet<string>) => {
    const current = paneRouterRef.current
    current.setParams({
      ...current.params,
      [INBOX_TYPE_PARAM]:
        filter.size === 0 ? undefined : [...filter].map(encodeURIComponent).join(','),
    })
  }, [])

  return (
    <>
      <CollapsedBackBar />
      <SectionErrorBoundary
        fallback={renderPaneFallback}
        label="inbox pane threw"
        onCatch={ignoreCaughtError}
      >
        <Inbox
          ask={props.options?.ask ?? false}
          contentGaps={props.options?.contentGaps}
          context={props.options?.context}
          initialAssigneeFilter={initial.assigneeFilter}
          initialTypeFilter={initial.typeFilter}
          initialView={initial.view}
          onAssigneeFilterChange={handleAssigneeFilterChange}
          onTypeFilterChange={handleTypeFilterChange}
          onViewChange={handleViewChange}
          sources={props.options?.sources ?? []}
          summarize={props.options?.summarize ?? true}
          suggestTodos={props.options?.suggestTodos ?? true}
        />
      </SectionErrorBoundary>
    </>
  )
}
