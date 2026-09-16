import {AddIcon} from '@sanity/icons/Add'
import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {FilterIcon} from '@sanity/icons/Filter'
import {SparklesIcon} from '@sanity/icons/Sparkles'
import {
  Avatar,
  AvatarStack,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Heading,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Text,
} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useCurrentUser, useSchema, useTranslation} from 'sanity'
import {keyframes, styled} from 'styled-components'

import {promptJson} from '../ai/promptJson'
import {useAgentClient} from '../ai/useAgentClient'
import {API_VERSION, STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {useAssessments} from '../store/useAssessments'
import {type useDismissals} from '../store/useDismissals'
import {type useSnoozes} from '../store/useSnoozes'
import {useSharedInboxStore} from '../studio/inboxCountLayout'
import {type StructureInboxConfig} from '../types'
import {SectionCard} from '../ui/SectionCard'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'
import {StatusDot} from '../ui/StatusDot'
import {AddMenu} from './AddMenu'
import {formatContentGapsDigest, surveyContentTypes} from './contentGapsDigest'
import {CreateItemRow} from './CreateItemRow'
import {ASSIGNEE_UNASSIGNED, matchesInboxFilters} from './inboxFilterSentinels'
import {InboxSection} from './InboxSection'
import {InboxStats} from './InboxStats'
import {initials, UnassignedAvatar} from './InboxRow'
import {mergeRows} from './mergeItems'
import {MergedList} from './MergedList'
import {SourceFeed, type SourceReport} from './SourceFeed'
import {type InboxSource, type InboxView, type SuggestTodosState} from './types'
import {useElementHeight} from './useElementHeight'

interface InboxProps {
  sources: InboxSource[]
  /** See `StructureInboxConfig.ask`'s own doc comment. */
  ask?: boolean
  /** See `StructureInboxConfig.contentGaps`'s own doc comment. */
  contentGaps?: StructureInboxConfig['contentGaps']
  /** See `StructureInboxConfig.context`'s own doc comment. */
  context?: string
}

/**
 * `main` at two-thirds width, `aside` at one-third — a real CSS container
 * query, not a viewport media query: this pane's own available width
 * depends on the Studio's left nav (collapsed or expanded) as much as the
 * browser window, so a breakpoint keyed to the viewport stacked (or didn't)
 * at the wrong moments relative to how much room this pane actually had.
 * Below 1024px of the pane's *own* width, a sidebar next to the list would
 * be a sliver — stack instead.
 *
 * Two elements, not one: a container query cannot match the container it is
 * querying, only that container's descendants (confirmed live — the single
 * `ResponsiveColumns` version this replaced set `container-type` and its own
 * `@container` rule on the same element, which the spec disallows, so the
 * override silently never applied at any width, however wide the window).
 * `ColumnsBoundary` establishes the container; `ResponsiveColumns`, its
 * child, is what actually queries it.
 */
const ColumnsBoundary = styled.div`
  container-type: inline-size;
`

const ResponsiveColumns = styled.div`
  display: grid;
  /* 20px — matches the padding={4} on the Box this whole grid sits inside
     (Inbox.tsx's own render, below), confirmed live: the gap between the
     two columns and the gap from each column to the pane's own outer edge
     used to be two different numbers (33px vs 20px), which read as an
     inconsistent, arbitrary layout rather than one deliberate unit of
     spacing used everywhere. */
  gap: 20px;
  grid-template-columns: 1fr;

  @container (min-width: 1024px) {
    grid-template-columns: 2fr 1fr;
  }
`

const fadeSlideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

/**
 * Summarize's and the AI-suggested-todos' own result cards both use this —
 * appearing in place with no transition at all, right where an editor is
 * already looking (just below the button they clicked), read as a jump
 * rather than a response to that click.
 */
const AnimateIn = styled.div`
  animation: ${fadeSlideIn} 180ms ease-out;
`

// Leaves exactly one slot for the "+N" overflow chip within the same
// visual budget `AvatarStack`'s own `maxLength={8}` used to claim.
const AVATAR_VISIBLE_LIMIT = 7

interface AssigneeOverflowMenuProps {
  overflowAssignees: {id: string; label: string; imageUrl?: string}[]
  assigneeFilter: ReadonlySet<string>
  toggleAssignee: (id: string) => void
  currentUser: ReturnType<typeof useCurrentUser>
  t: ReturnType<typeof useTranslation>['t']
}

/**
 * The Jira-style "+N" chip at the end of the assignee avatar stack —
 * everyone `AVATAR_VISIBLE_LIMIT` didn't fit, opening a checkbox menu for
 * exactly the hidden people, rather than truncating them out of reach
 * entirely (see `visibleAssignees`' own doc comment in `Inbox`). Its own
 * component, not inlined into `Inbox` itself: confirmed live that
 * inlining this JSX (even just the plain derived `visibleAssignees`/
 * `overflowAssignees` values it needs, before any JSX at all) made React
 * Compiler bail out of memoizing several unrelated `useCallback`s
 * elsewhere in that component — wrapping those two values in their own
 * `useMemo` (see `Inbox`) was the actual fix; this extraction just keeps
 * the resulting code out of `Inbox`'s own already-long render body.
 */
function AssigneeOverflowMenu(props: AssigneeOverflowMenuProps) {
  const {overflowAssignees, assigneeFilter, toggleAssignee, currentUser, t} = props

  return (
    <MenuButton
      button={
        <button
          aria-label={t('assignee.more', {count: overflowAssignees.length})}
          style={{
            alignItems: 'center',
            background: 'var(--card-border-color)',
            border: '2px solid var(--card-bg-color)',
            borderRadius: '50%',
            color: 'inherit',
            cursor: 'pointer',
            display: 'inline-flex',
            font: 'inherit',
            fontSize: '0.75em',
            fontWeight: 600,
            height: '1.625em',
            justifyContent: 'center',
            marginLeft: '-4px',
            padding: 0,
            position: 'relative',
            verticalAlign: 'middle',
            width: '1.625em',
            // Lowest of the whole stack: it's the last circle, same
            // overlap direction as every avatar before it.
            zIndex: -1,
          }}
          type="button"
        >
          +{overflowAssignees.length}
        </button>
      }
      id="structure-inbox-assignee-overflow-menu"
      menu={
        <Menu>
          {overflowAssignees.map((person) => (
            <MenuItem
              icon={assigneeFilter.has(person.id) ? CheckmarkIcon : undefined}
              key={person.id}
              onClick={() => toggleAssignee(person.id)}
              pressed={assigneeFilter.has(person.id)}
              text={
                currentUser && person.id === currentUser.id
                  ? t('assignee.you', {name: person.label})
                  : person.label
              }
            />
          ))}
        </Menu>
      }
      popover={{placement: 'bottom-end', portal: true}}
    />
  )
}

const OPEN_TAB_ID = 'structure-inbox-open'
const CLEARED_TAB_ID = 'structure-inbox-cleared'
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
  const {source, compact, dismissals, snoozes, onCount, view} = props

  const renderFallback = useCallback(
    (error: Error): ReactNode => (
      <SectionCard error={error} title={source.title}>
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
        snoozes={snoozes}
        source={source}
        view={view}
      />
    </SectionErrorBoundary>
  )
}

interface BoundedSourceFeedProps {
  source: InboxSource
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
  const {source, snoozes, now, onReport} = props

  const handleCatch = useCallback(
    (error: Error) => {
      onReport(source.name, {source, error, open: [], cleared: [], snoozed: []})
    },
    [source, onReport],
  )

  return (
    <SectionErrorBoundary fallback={null} onCatch={handleCatch}>
      <SourceFeed now={now} onReport={onReport} snoozes={snoozes} source={source} />
    </SectionErrorBoundary>
  )
}

export function Inbox({sources, ask = false, contentGaps, context}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const client = useClient({apiVersion: API_VERSION})
  const schema = useSchema()
  const {dismissals, snoozes} = useSharedInboxStore()
  // Not through `useSharedInboxStore`, unlike dismissals/snoozes: nothing
  // outside this pane needs a cached assessment (no open-count-style
  // always-mounted consumer reads it), so a plain local instance is enough —
  // only `InboxRow` ever reads or writes one.
  const assessments = useAssessments()
  const currentUser = useCurrentUser()
  const [view, setView] = useState<InboxView>('open')

  // Caps the Inbox list at the sidebar's own actual rendered height, rather
  // than an eyeballed pixel constant — the sidebar's height already varies
  // with how many aside sources are configured, so a fixed cap could either
  // clip earlier than necessary or leave the list towering over a short
  // sidebar. `undefined` until the first measurement; `MergedList` falls
  // back to a sane default for that one render.
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarHeight = useElementHeight(sidebarRef)

  // A snoozed item wakes on its own once `until` passes — see the identical
  // reasoning `InboxSection` used to carry itself, now shared by every main
  // source's feed so they all split open/snoozed against the same instant.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const showOpen = useCallback(() => setView('open'), [])
  const showCleared = useCallback(() => setView('cleared'), [])
  const showSnoozed = useCallback(() => setView('snoozed'), [])

  const [reports, setReports] = useState<Record<string, SourceReport>>({})
  const handleReport = useCallback((sourceName: string, report: SourceReport) => {
    setReports((current) => ({...current, [sourceName]: report}))
  }, [])

  // Aside sources still report an open count the old way; nothing reads it
  // since the headline below is computed from `reports` instead, but
  // `InboxSection` requires the prop.
  const ignoreCount = useCallback(() => {}, [])

  const {main, aside} = useMemo(
    () => ({
      main: sources.filter((source) => (source.placement ?? 'main') === 'main'),
      aside: sources.filter((source) => source.placement === 'aside'),
    }),
    [sources],
  )

  const mainOrder = useMemo(() => main.map((source) => source.name), [main])

  // The "add new" trigger for a source that keeps its own items (today, only
  // `todos`) — now lives up here, on the tab row, instead of above the
  // merged list. `MergedList` still owns the *edit* dialog for the same
  // source, mounted only while an item is actually being edited.
  const creators = useMemo(
    () =>
      mainOrder
        .map((name) => reports[name])
        .filter((report): report is SourceReport => Boolean(report?.create || report?.update)),
    [mainOrder, reports],
  )

  // Bumped per creator source to pop that source's own (hidden-trigger)
  // `CreateItemRow` dialog open from `AddMenu` — see `CreateItemRow`'s own
  // `openSignal` prop for why a counter rather than a plain boolean.
  const [createSignals, setCreateSignals] = useState<Record<string, number>>({})
  const requestCreate = useCallback((sourceName: string) => {
    setCreateSignals((current) => ({...current, [sourceName]: (current[sourceName] ?? 0) + 1}))
  }, [])

  // A source-level action unrelated to any one item — "Scan for issues",
  // say — rendered as its own button in this column's own header (see
  // `MergedList`'s own `actions` doc comment) rather than in a per-source
  // header: every `main` source's items merge into one list, so there is no
  // single source's own header to put this in.
  const actionSources = useMemo(
    () => mainOrder.map((name) => reports[name]).filter((report): report is SourceReport => Boolean(report?.action)),
    [mainOrder, reports],
  )
  const [runningActions, setRunningActions] = useState<Record<string, boolean>>({})
  // The one-line result `action.run()` resolves with, if any — rendered as
  // its own dismissible card, same shape (and same reasoning) as
  // Summarize's/Suggest todos' own result below: a scan that ran silently
  // gave no sign it had done anything beyond the button's own pending
  // state. Keyed by source name since more than one `main` source could in
  // principle offer an `action`.
  const [actionResults, setActionResults] = useState<
    Record<string, {status: 'done'; message: string} | {status: 'error'}>
  >({})
  const dismissActionResult = useCallback((sourceName: string) => {
    setActionResults((current) => {
      const next = {...current}
      delete next[sourceName]
      return next
    })
  }, [])
  const runSourceAction = useCallback((report: SourceReport) => {
    const {action} = report
    if (!action) return
    const {name} = report.source
    setRunningActions((current) => ({...current, [name]: true}))
    dismissActionResult(name)
    action
      .run()
      .then((message) => {
        if (message) setActionResults((current) => ({...current, [name]: {status: 'done', message}}))
        return undefined
      })
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] source action failed', error)
        setActionResults((current) => ({...current, [name]: {status: 'error'}}))
      })
      .finally(() => {
        setRunningActions((current) => ({...current, [name]: false}))
      })
  }, [dismissActionResult])

  // Every main-source row across *all three* tabs, not just whichever one is
  // currently selected — used only to decide which filter chips exist, never
  // to decide what's shown. Scoping this to just `view` used to mean the
  // filter bar itself would appear, disappear, and re-shuffle its chips as
  // an editor switched tabs (Snoozed showing one lone unassigned draft has
  // nothing to filter on its own, even though Open and Cleared both do) —
  // which reads as the controls being broken, not as them correctly
  // reflecting a smaller tab. The chips themselves stay stable;
  // `matchesInboxFilters` below still only ever filters whatever `view` is
  // actually showing.
  const allRowsAnyView = useMemo(
    () =>
      (['open', 'cleared', 'snoozed'] as const).flatMap((v) =>
        mergeRows(reports, mainOrder, v, dismissals.state),
      ),
    [reports, mainOrder, dismissals.state],
  )

  // Every assignee present anywhere, not the full project roster — a chip
  // for someone with nothing in any view would still be a dead filter. Keyed
  // by id, not label: two project members can share a display name (a real
  // case this plugin has actually hit), and keying on the text they happen
  // to render as would silently merge them into one chip.
  const availableAssignees = useMemo(() => {
    const byId = new Map<string, {id: string; label: string; imageUrl?: string}>()
    for (const row of allRowsAnyView) {
      if (row.item.assignee) byId.set(row.item.assignee.id, row.item.assignee)
    }
    // The viewer's own chip leads the stack — "is any of this mine" is the
    // first question an editor asks of a shared queue, and the leftmost
    // avatar is already the one that paints on top (see the z-index note
    // below), so this doubles as "yours is the one always fully visible."
    // Everyone else stays alphabetical, same as before.
    return [...byId.values()].sort((a, b) => {
      const aIsYou = a.id === currentUser?.id
      const bIsYou = b.id === currentUser?.id
      if (aIsYou !== bIsYou) return aIsYou ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }, [allRowsAnyView, currentUser])

  // "Unassigned" only counts for a row whose source actually offers
  // `assign` — a todo or release was never assignable to begin with, so it
  // isn't "unassigned," it's just not that kind of thing.
  const hasUnassignedRow = useMemo(
    () => allRowsAnyView.some((row) => !row.item.assignee && reports[row.sourceName]?.assign),
    [allRowsAnyView, reports],
  )
  // A filter row earns its place only once it could actually narrow
  // something — one assignee and nobody unassigned is exactly the single
  // avatar already on that one row, restated as a chip.
  const showAssigneeFilter = availableAssignees.length + (hasUnassignedRow ? 1 : 0) > 1

  // `AvatarStack`'s own `maxLength` truncates visually but has no click
  // handler of its own for whatever it hides — every avatar here is our
  // own plain `<button>`, not something that component's overflow counter
  // can open a picker for, so a team with more people than fit would have
  // some genuinely unreachable through this filter (confirmed: there's no
  // prop for it). Slicing ourselves and giving the overflow its own menu
  // (`AssigneeOverflowMenu`) means every assignee stays togglable
  // regardless of headcount. Both wrapped in their own `useMemo`, not
  // plain derived consts — confirmed live that a plain
  // `availableAssignees.slice(...)` here, even before any JSX used it,
  // made React Compiler bail out of memoizing several unrelated
  // `useCallback`s elsewhere in this component.
  const visibleAssignees = useMemo(
    () => availableAssignees.slice(0, AVATAR_VISIBLE_LIMIT),
    [availableAssignees],
  )
  const overflowAssignees = useMemo(
    () => availableAssignees.slice(AVATAR_VISIBLE_LIMIT),
    [availableAssignees],
  )

  // Every source contributing a row anywhere, in the configured order — same
  // reasoning as `availableAssignees`.
  const availableTypes = useMemo(() => {
    const present = new Set(allRowsAnyView.map((row) => row.sourceName))
    return mainOrder
      .map((name) => reports[name])
      .filter((report): report is SourceReport => Boolean(report) && present.has(report.source.name))
  }, [allRowsAnyView, mainOrder, reports])

  // Both empty means "no filter applied" (show everything) — not "hide
  // everything" — so a fresh pane starts unfiltered rather than blank.
  // Jira-style multi-select: checking several people (or nobody plus several
  // people) narrows to their union, not just one at a time.
  const [assigneeFilter, setAssigneeFilter] = useState<ReadonlySet<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<string>>(new Set())

  const toggleSetMember = useCallback(
    (setState: (updater: (current: ReadonlySet<string>) => ReadonlySet<string>) => void) =>
      (key: string) => {
        setState((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      },
    [],
  )
  const toggleAssignee = useMemo(() => toggleSetMember(setAssigneeFilter), [toggleSetMember])
  const toggleType = useMemo(() => toggleSetMember(setTypeFilter), [toggleSetMember])

  // Fixed to the `open` view regardless of which tab is actually selected —
  // the headline above the tabs is always "how many things are open," even
  // while looking at Done or Snoozed. Kept separate from `allRowsAnyView`
  // above (which covers every tab at once, for the filter bar's own
  // available-assignee/-type lists).
  const openRows = useMemo(
    () => mergeRows(reports, mainOrder, 'open', dismissals.state),
    [reports, mainOrder, dismissals.state],
  )

  // Feeds `InboxStats`' own `nextWake` — the only state in this pane an
  // editor cannot see from wherever they currently are, so the Overview
  // card needs it regardless of which tab is actually open right now.
  const snoozedRows = useMemo(
    () => mergeRows(reports, mainOrder, 'snoozed', dismissals.state),
    [reports, mainOrder, dismissals.state],
  )

  // A pane-level read across everything currently open, not one item —
  // same Agent Actions call `unpublishedDrafts.ts`'s own `assess` makes,
  // same "informational only, never automatic" shape: only ever runs on a
  // click, never in the background, and never writes anything back. Capped
  // at 30 rows so a large inbox doesn't turn one click into an unbounded
  // prompt.
  const agentClient = useAgentClient()
  const [summary, setSummary] = useState<
    {status: 'idle'} | {status: 'loading'} | {status: 'done'; message: string} | {status: 'error'}
  >({status: 'idle'})

  const handleSummarize = useCallback(async () => {
    setSummary({status: 'loading'})
    const digest = openRows
      .slice(0, 30)
      .map((row) => `- ${row.item.title}${row.item.subtitle ? ` (${row.item.subtitle})` : ''}`)
      .join('\n')

    if (!agentClient) {
      setSummary({status: 'error'})
      return
    }

    try {
      const message = await agentClient.agent.action.prompt({
        instruction:
          (context ? `About this project: ${context}\n---\n` : '') +
          'Given this list of open inbox items, one per line:\n$items\n---\n' +
          'In two or three short sentences, say what looks most worth starting with first and why.',
        instructionParams: {items: digest || 'Nothing is open right now.'},
      })
      setSummary({status: 'done', message})
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] summarize failed', error)
      setSummary({status: 'error'})
    }
  }, [agentClient, openRows, context])

  const [suggestions, setSuggestions] = useState<SuggestTodosState>({status: 'idle'})

  // The one thing an editor can actually do with a suggestion: add it to
  // their own personal list, the same `todos` source's own "add one" input
  // already writes through. Read from `reports`, not a second `useTodos()`
  // call here — a second instance would keep its own separate local copy of
  // the same document, so an add through it wouldn't show up in the real
  // list (the one `todos.ts`'s own `useItems` renders) until a reload.
  // Undefined when no `todos` source is configured at all, same as
  // `onSummarize` below being optional: the link this powers just doesn't
  // render rather than offering suggestions with nowhere real to put them.
  const addTodo = reports.todos?.create

  const handleSuggestTodos = useCallback(async () => {
    setSuggestions({status: 'loading'})
    const digest = openRows
      .slice(0, 30)
      .map((row) => `- ${row.item.title}${row.item.subtitle ? ` (${row.item.subtitle})` : ''}`)
      .join('\n')

    if (!agentClient) {
      setSuggestions({status: 'error'})
      return
    }

    try {
      type SuggestionChoice = {items: {title: string; reason: string}[]}

      const choice = await promptJson<SuggestionChoice>(
        agentClient,
        (context ? `About this project: ${context}\n---\n` : '') +
          'Given this list of open inbox items, one per line:\n$items\n---\n' +
          'Suggest at most 3 concrete personal todos an editor could add to make progress on ' +
          'these — each a short, specific, imperative title (max ~8 words) plus a one-sentence ' +
          'reason. Return JSON {"items": [{"title": string, "reason": string}]}. If nothing open ' +
          'warrants a new todo, return {"items": []}.',
        {items: digest || 'Nothing is open right now.'},
      )

      setSuggestions({status: 'done', items: (choice?.items ?? []).slice(0, 3)})
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] suggest-todos failed', error)
      setSuggestions({status: 'error'})
    }
  }, [agentClient, openRows, context])

  // "Find content gaps" — same "insight, then nothing automatic" shape as
  // Summarize/Suggest todos above, but reading the project's own content
  // instead of the current queue: only rendered at all when
  // `StructureInboxConfig.contentGaps` is configured (see that option's own
  // doc comment for why this is opt-in, unlike everything else here).
  const [contentGapsResult, setContentGapsResult] = useState<
    | {status: 'idle'}
    | {status: 'loading'}
    | {status: 'done'; items: {title: string; reason: string}[]}
    | {status: 'error'}
  >({status: 'idle'})

  const handleFindContentGaps = useCallback(async () => {
    setContentGapsResult({status: 'loading'})

    if (!agentClient) {
      setContentGapsResult({status: 'error'})
      return
    }

    try {
      const summaries = await surveyContentTypes(client, schema)
      const digest = formatContentGapsDigest(summaries)

      type GapsChoice = {gaps: {title: string; reason: string}[]}

      const choice = await promptJson<GapsChoice>(
        agentClient,
        (context ? `About this project: ${context}\n---\n` : '') +
          'Here is a survey of every content type in this Sanity project, how many documents ' +
          "each has, and a small sample of real text from each (when available):\n$survey\n---\n" +
          'Suggest at most 5 concrete content gaps — things that seem missing given what this ' +
          'project already has (an under-supported claim, a content type with far fewer entries ' +
          "than a related one, a topic mentioned in samples but with nothing dedicated to it). " +
          'Each gap: a short, specific title (max ~10 words) and a one-sentence reason grounded ' +
          'in the actual survey data, not a generic best practice. Return JSON ' +
          '{"gaps": [{"title": string, "reason": string}]}. If nothing looks like a real gap, ' +
          'return {"gaps": []}.',
        {survey: digest || 'This project has no content types with any documents yet.'},
      )

      setContentGapsResult({status: 'done', items: (choice?.gaps ?? []).slice(0, 5)})
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] find-content-gaps failed', error)
      setContentGapsResult({status: 'error'})
    }
  }, [agentClient, client, schema, context])

  const dismissContentGap = useCallback((index: number) => {
    setContentGapsResult((current) =>
      current.status === 'done' ? {...current, items: current.items.filter((_, i) => i !== index)} : current,
    )
  }, [])

  // The actual add (a real, one-shot write) happens here, in the event
  // handler itself — never inside the `setSuggestions` updater below. React
  // invokes a state updater function twice under StrictMode to catch exactly
  // this shape of bug: an updater that isn't pure. Confirmed live, the hard
  // way, before this comment existed — one click doubled the todo, since the
  // side effect ran once per invocation of the updater.
  const handleAddSuggestion = useCallback(
    (index: number) => {
      if (suggestions.status === 'done') {
        const suggestion = suggestions.items[index]
        if (suggestion) void addTodo?.({title: suggestion.title})
      }

      setSuggestions((current) =>
        current.status === 'done' ? {...current, items: current.items.filter((_, i) => i !== index)} : current,
      )
    },
    [suggestions, addTodo],
  )

  const handleDismissSuggestion = useCallback((index: number) => {
    setSuggestions((current) =>
      current.status === 'done' ? {...current, items: current.items.filter((_, i) => i !== index)} : current,
    )
  }, [])

  // Only the main column counts toward the headline. The aside is context —
  // "three releases are scheduled" is not three things asking for your
  // attention, and folding it in would make the number cry wolf. Filtered by
  // the same assignee/type state as the list below, so the headline never
  // says "8 things" while a filter is only showing 2 of them.
  const openCount = useMemo(
    () => openRows.filter((row) => matchesInboxFilters(row, assigneeFilter, typeFilter)).length,
    [openRows, assigneeFilter, typeFilter],
  )

  // Names who the headline is about — a shared team inbox by default (no
  // filter means "everyone's queue," not "your queue"), narrowing to "you" or
  // a named person only once the assignee filter actually picks out exactly
  // one. Several people, or Unassigned in the mix, has no single clean noun
  // to name, so the headline just states the count with no "on X" at all
  // rather than guess at a phrase.
  const headlineSubject = useMemo((): {kind: 'team' | 'you' | 'generic'} | {kind: 'named'; name: string} => {
    if (assigneeFilter.size === 0) return {kind: 'team'}
    if (assigneeFilter.size === 1) {
      const [only] = assigneeFilter
      if (currentUser && only === currentUser.id) return {kind: 'you'}
      const person = availableAssignees.find((assignee) => assignee.id === only)
      if (person) return {kind: 'named', name: person.label}
    }
    return {kind: 'generic'}
  }, [assigneeFilter, availableAssignees, currentUser])

  // `openRows` restricted to sources that offer `assign` — the only ones
  // "unassigned" means anything for (a todo or release was never assignable
  // to begin with) — same distinction `hasUnassignedRow` above already
  // draws for the filter bar's own "Unassigned" chip. Feeds `InboxStats`'
  // unassigned-count widget.
  const assignableRows = useMemo(
    () => openRows.filter((row) => reports[row.sourceName]?.assign),
    [openRows, reports],
  )

  // Rendered here (state and available-lists live in this component, for
  // `openCount` above) but handed down to `MergedList` to actually place —
  // these filters only ever govern that one column, never the aside sources
  // beside it (a release or a draft has no assignee, and grouping releases
  // by type would just be one bucket), so they belong in that column's own
  // header rather than spanning the whole pane above both boxes.
  const filterBar = (showAssigneeFilter || availableTypes.length > 1) && (
    <Flex gap={3} wrap="wrap">
      {showAssigneeFilter && (
        // A real avatar-stack (Sanity UI's own component: overlapping
        // circles, not a row of separate buttons) — clicking the
        // already-active one clears back to "no filter" instead of a
        // separate "Everyone" control, the same toggle-off behaviour every
        // other filter in this bar already uses.
        <AvatarStack size={1}>
          {/* Each avatar wrapped in a plain, unstyled `<button>` rather than
              styled directly — putting the ring and the `as="button"` tag
              swap on `Avatar`/`UnassignedAvatar` themselves fought their own
              internal layout (their person-glyph overlay lost its position,
              and the ring's square corners showed past the circle). A
              wrapper button owns its own box model instead, leaving both
              components exactly as they render everywhere else. */}
          {/* Explicit, decreasing `zIndex` left to right: the leftmost
              avatar has the highest z-index and paints on top, each later
              one tucked behind the one before it. Plain DOM order alone
              left the browser to decide, which put the later one on top
              instead. */}
          {visibleAssignees.map((person, index) => (
            <button
              aria-label={person.label}
              aria-pressed={assigneeFilter.has(person.id)}
              key={person.id}
              onClick={() => toggleAssignee(person.id)}
              // `aria-label` alone names it for assistive tech but draws no
              // visible tooltip — `title` is what gives an icon-only avatar
              // the same hover-to-see-the-name Studio's own top-right avatar
              // already has, which matters more here: several of these can
              // render as bare initials with no photo at all. Marks the
              // viewer's own chip explicitly — two teammates can share a
              // display name (a real case this project has hit), and without
              // this an editor hovering their own avatar has no way to tell
              // it apart from someone else's identically-named one.
              title={
                currentUser && person.id === currentUser.id
                  ? t('assignee.you', {name: person.label})
                  : person.label
              }
              style={{
                background: 'none',
                // A ring matching the header's own background, not `none` —
                // the same "cutout" every avatar-stack that reads as clean
                // separation (rather than photos just smashed together)
                // uses. `--card-bg-color` is the ancestor `<Card>`'s own CSS
                // custom property (set by Sanity UI, not this plugin), so
                // this tracks whatever that Card's background actually is —
                // including a theme or scheme switch — instead of a color
                // measured once off the dark theme and frozen.
                border: '2px solid var(--card-bg-color)',
                borderRadius: '50%',
                boxShadow: assigneeFilter.has(person.id) ? '0 0 0 2px currentColor' : 'none',
                color: 'inherit',
                cursor: 'pointer',
                font: 'inherit',
                // `AvatarStack`'s own built-in overlap (the theme's
                // `avatar.sizes[1].distance`, ~4px) is too thin for the ring
                // above to read as a cutout — at that overlap the two
                // borders just about touch, so adjacent avatars looked like
                // flush circles with no visible separation. Stacking extra
                // negative margin on top of it widens the overlap enough
                // for the on-top avatar's own ring to visibly bite into the
                // one behind.
                marginLeft: index > 0 ? '-4px' : undefined,
                padding: 0,
                position: 'relative',
                // `AvatarStack` wraps each child in its own `inline-block`
                // div with the browser default `vertical-align: baseline` —
                // fine when every avatar renders the same way, but a photo
                // (`<img>`) and initials-only text sit on different
                // intrinsic baselines, so the two visibly drifted apart by
                // a couple of pixels. `middle` aligns by box, not text
                // baseline, so it holds regardless of which one an avatar
                // happens to render as.
                verticalAlign: 'middle',
                zIndex: visibleAssignees.length - index,
              }}
              type="button"
            >
              <Avatar initials={initials(person.label)} size={1} src={person.imageUrl} />
            </button>
          ))}
          {hasUnassignedRow && (
            <button
              aria-label={t('assignee.unassigned')}
              aria-pressed={assigneeFilter.has(ASSIGNEE_UNASSIGNED)}
              onClick={() => toggleAssignee(ASSIGNEE_UNASSIGNED)}
              title={t('assignee.unassigned')}
              style={{
                background: 'none',
                // A ring matching the header's own background, not `none` —
                // the same "cutout" every avatar-stack that reads as clean
                // separation (rather than photos just smashed together)
                // uses. `--card-bg-color` is the ancestor `<Card>`'s own CSS
                // custom property (set by Sanity UI, not this plugin), so
                // this tracks whatever that Card's background actually is —
                // including a theme or scheme switch — instead of a color
                // measured once off the dark theme and frozen.
                border: '2px solid var(--card-bg-color)',
                borderRadius: '50%',
                boxShadow: assigneeFilter.has(ASSIGNEE_UNASSIGNED) ? '0 0 0 2px currentColor' : 'none',
                color: 'inherit',
                cursor: 'pointer',
                font: 'inherit',
                // See the matching comment above: widens the built-in
                // overlap enough for the ring to read as a visible cutout.
                marginLeft: visibleAssignees.length > 0 ? '-4px' : undefined,
                padding: 0,
                position: 'relative',
                verticalAlign: 'middle',
                zIndex: 0,
              }}
              type="button"
            >
              <UnassignedAvatar size={1} />
            </button>
          )}
          {overflowAssignees.length > 0 && (
            <AssigneeOverflowMenu
              assigneeFilter={assigneeFilter}
              currentUser={currentUser}
              overflowAssignees={overflowAssignees}
              t={t}
              toggleAssignee={toggleAssignee}
            />
          )}
        </AvatarStack>
      )}

      {availableTypes.length > 1 && (
        <MenuButton
          button={
            <Box style={{position: 'relative'}}>
              <Button aria-label={t('filter.type')} fontSize={1} icon={FilterIcon} mode="bleed" padding={2} />
              {typeFilter.size > 0 && (
                // A count instead of a blue "active" fill — the fill read as
                // just another button state, not as "N filters applied."
                <Badge
                  fontSize={0}
                  padding={1}
                  radius="full"
                  style={{
                    minWidth: '1.2em',
                    pointerEvents: 'none',
                    position: 'absolute',
                    right: -4,
                    textAlign: 'center',
                    top: -4,
                  }}
                  tone="primary"
                >
                  {typeFilter.size}
                </Badge>
              )}
            </Box>
          }
          id="structure-inbox-type-filter"
          menu={
            // A handful of short words (`Task`, `Draft`, `Todo`) left to
            // their own natural width made the whole popover shrink-wrap
            // down to almost nothing — technically fine, visually like a
            // rendering bug. A floor width fixes it without hardcoding a
            // specific menu length.
            <Menu style={{minWidth: 160}}>
              {/* Matches Studio's own "..." menu pattern (sort/layout options
                  grouped under a small muted label) rather than a permanent
                  row of type chips next to the assignee avatars — one
                  collapsed control instead of two things competing for
                  attention on first glance. */}
              <Box paddingX={3} paddingY={2}>
                <Text muted size={0} weight="semibold">
                  {t('filter.type')}
                </Text>
              </Box>
              {availableTypes.map((report) => (
                <MenuItem
                  iconRight={typeFilter.has(report.source.name) ? CheckmarkIcon : undefined}
                  key={report.source.name}
                  onClick={() => toggleType(report.source.name)}
                  pressed={typeFilter.has(report.source.name)}
                  text={report.source.title}
                />
              ))}
            </Menu>
          }
          popover={{placement: 'bottom-end', portal: true}}
        />
      )}
    </Flex>
  )

  // Every control that only ever affects the main column — Summarize,
  // Suggest todos, a source's own `action` (Scan for issues), and Add — all
  // built here (the state they drive lives in this component regardless of
  // where they render), then handed to `MergedList` to draw inside its own
  // header. None of these ever touch the aside column beside it, so they
  // belong in a header that only spans the main column too — see
  // `MergedList`'s own `actions` doc comment for why that used to not be
  // true.
  const mainColumnActions = (
    <>
      {/* A pane-level read, not tied to one source, so it belongs beside
          Suggest todos/Scan rather than inside any one source's own
          controls. */}
      <Tooltip
        content={
          <Box padding={2}>
            <Text size={1}>{t('summarize.hint')}</Text>
          </Box>
        }
        placement="bottom"
      >
        <Button
          disabled={summary.status === 'loading'}
          fontSize={1}
          icon={SparklesIcon}
          mode="ghost"
          onClick={handleSummarize}
          text={summary.status === 'loading' ? t('summarize.loading') : t('summarize.ask')}
        />
      </Tooltip>

      {/* Same tier as Summarize — both are AI reads across everything open
          right now, triggered from the same toolbar. Used to live as a
          plain link inside the Overview stats card; moved out once a short
          inbox (the common case) made that card render as almost nothing
          but this one link, which read as its own kind of misplaced. */}
      {addTodo && (
        <Button
          disabled={suggestions.status === 'loading'}
          fontSize={1}
          icon={SparklesIcon}
          mode="ghost"
          onClick={handleSuggestTodos}
          text={suggestions.status === 'loading' ? t('todoSuggest.loading') : t('todoSuggest.ask')}
        />
      )}

      {/* Same tier again — a third AI read across the project's own
          content, not just the current queue. Only rendered when
          `contentGaps` is configured: unlike Summarize/Suggest todos, this
          one's output is a judgment call, not a fact, and it's the
          heaviest read here (see `StructureInboxConfig.contentGaps`'s own
          doc comment) — an opt-in, not a default. */}
      {contentGaps && (
        <Button
          disabled={contentGapsResult.status === 'loading'}
          fontSize={1}
          icon={SparklesIcon}
          mode="ghost"
          onClick={handleFindContentGaps}
          text={contentGapsResult.status === 'loading' ? t('contentGaps.loading') : t('contentGaps.ask')}
        />
      )}

      {/* Ahead of the creators control, not after: that one stays the
          right-most, primary action a returning editor already knows, and a
          source-level action is the newer, less frequent one. Ghost mode
          for the same reason — until there's a real signal to weigh one
          action over the other, neither should read as more important than
          the other. */}
      {actionSources.map((report) => {
        const {action} = report
        if (!action) return null
        const running = runningActions[report.source.name] ?? false
        const button = (
          <Button
            disabled={running}
            fontSize={1}
            icon={action.icon}
            mode="ghost"
            onClick={() => runSourceAction(report)}
            text={running ? (action.pendingLabel ?? action.label) : action.label}
          />
        )
        if (!action.description) return <Box key={report.source.name}>{button}</Box>
        return (
          <Tooltip
            content={
              <Box padding={2}>
                <Text size={1}>{action.description}</Text>
              </Box>
            }
            key={report.source.name}
            placement="bottom"
          >
            {button}
          </Tooltip>
        )
      })}
      {/* A creator source (today, only `todos`) — distinct from `AddMenu`
          (the pane-wide "Add content", back beside the tabs): this only
          ever adds to the editor's own queue, so it lives here, next to
          Suggest todos, not with the source-agnostic global one. Exactly
          one creator (today's only real case) gets a plain button with
          that source's own label rather than a one-item menu, which would
          just be an extra click to reach the only option in it. */}
      {creators.length === 1 && (
        <Button
          fontSize={1}
          icon={AddIcon}
          mode="ghost"
          onClick={() => requestCreate(creators[0].source.name)}
          text={creators[0].source.name === 'todos' ? t('todos.addButton') : creators[0].source.title}
          tone="primary"
        />
      )}
      {creators.length > 1 && (
        <MenuButton
          button={<Button fontSize={1} icon={AddIcon} mode="ghost" text={t('inbox.addMenu')} tone="primary" />}
          id="structure-inbox-add-creator-menu"
          menu={
            <Menu>
              {creators.map((report) => (
                <MenuItem
                  icon={AddIcon}
                  key={report.source.name}
                  onClick={() => requestCreate(report.source.name)}
                  text={report.source.name === 'todos' ? t('todos.addButton') : report.source.title}
                />
              ))}
            </Menu>
          }
          popover={{placement: 'bottom-end', portal: true}}
        />
      )}
      {/* Hidden-trigger dialogs only — the control above is the only
          visible entry point; each one still needs to be mounted somewhere
          to have a dialog `requestCreate` can pop open. Mounted regardless
          of tab — adding a new item always adds it as open, whichever tab
          that dialog happened to be triggered from. */}
      {creators.map((report) => (
        <CreateItemRow
          hideTrigger
          key={report.source.name}
          onCreate={(input) => report.create?.(input)}
          openSignal={createSignals[report.source.name]}
        />
      ))}
    </>
  )

  // Every AI/action result this column can produce — Summarize's,
  // Suggest todos', Find content gaps', and a source's own `action`'s
  // (Scan for issues). Handed to `MergedList` (its own `results` prop)
  // to render directly beneath the toolbar that triggered them, rather
  // than above this whole card: a click on a button down here used to
  // produce a card that appeared *above* the toolbar, checkbox row, and
  // Ask input — visually backwards from where the editor was just
  // looking. Built here (the state lives in this component) but placed
  // by `MergedList`, the same split `actions` already uses.
  const mainColumnResults = (
    <>
      {/* Same loading/done/error shape as `InboxRow.tsx`'s own
          `assessRow` — this is the pane-level version of the same
          capability, not a different pattern. Dismissible rather than
          tied to `summary.status` alone: a stale read from before the
          list changed shouldn't linger silently forever, but the editor
          decides when they're done with it, not the next render. */}
      {(summary.status === 'done' || summary.status === 'error') && (
        <Box marginBottom={4}>
          <AnimateIn>
            <Card
              border
              paddingBottom={5}
              paddingTop={3}
              paddingX={4}
              radius={2}
              tone={summary.status === 'error' ? 'critical' : 'primary'}
            >
              <Stack gap={3}>
                <Flex align="center" justify="space-between">
                  <Text size={1} weight="semibold">
                    {t('summarize.title')}
                  </Text>
                  <Button
                    fontSize={1}
                    mode="bleed"
                    onClick={() => setSummary({status: 'idle'})}
                    padding={2}
                    style={{marginRight: -8, marginTop: -6}}
                    text={t('summarize.dismiss')}
                  />
                </Flex>
                {/* Capped, not the column's own full width: body
                    text wants roughly 60-75 characters per line,
                    not the same edge-to-edge width a data-dense
                    row list uses. */}
                <Box style={{maxWidth: '640px'}}>
                  <Text size={1}>
                    {summary.status === 'error' ? t('summarize.error') : summary.message}
                  </Text>
                </Box>
              </Stack>
            </Card>
          </AnimateIn>
        </Box>
      )}

      {/* The "action" half of `todoSuggest.ask`'s trigger in the
          toolbar above — same dismissible-card shape Summarize's own
          result already uses. Not tied to `suggestions.status === 'done'`
          alone: an error or an empty result both need the same explicit
          "Dismiss" a done-with-items result gets, rather than silently
          blocking the trigger from ever showing again (its own header
          button hides once `suggestions.status === 'done'`, the same gate
          `summarize.ask` never needed since it can always re-run). */}
      {addTodo && (suggestions.status === 'done' || suggestions.status === 'error') && (
        <Box marginBottom={4}>
          <AnimateIn>
            <Card
              border
              paddingBottom={5}
              paddingTop={3}
              paddingX={4}
              radius={2}
              tone={suggestions.status === 'error' ? 'critical' : 'primary'}
            >
              <Stack gap={3}>
                {suggestions.status === 'error' && (
                  <Flex align="flex-start" gap={3} justify="space-between">
                    <Text size={1}>{t('todoSuggest.error')}</Text>
                    <Button
                      fontSize={1}
                      mode="bleed"
                      onClick={() => setSuggestions({status: 'idle'})}
                      padding={2}
                      text={t('todoSuggest.dismiss')}
                    />
                  </Flex>
                )}

                {suggestions.status === 'done' && suggestions.items.length === 0 && (
                  <Flex align="flex-start" gap={3} justify="space-between">
                    <Text size={1}>{t('todoSuggest.none')}</Text>
                    <Button
                      fontSize={1}
                      mode="bleed"
                      onClick={() => setSuggestions({status: 'idle'})}
                      padding={2}
                      text={t('todoSuggest.dismiss')}
                    />
                  </Flex>
                )}

                {suggestions.status === 'done' && suggestions.items.length > 0 && (
                  <Stack gap={4}>
                    {/* Every other state this card can be in
                        (error, nothing found) already names
                        itself in its own sentence, next to a
                        whole-card `Dismiss` — a bare item list
                        had neither: no title on its own left
                        edge, and (until now) no way to close the
                        card without acting on each item first. */}
                    <Flex align="center" justify="space-between">
                      <Text size={1} weight="semibold">
                        {t('todoSuggest.title')}
                      </Text>
                      <Button
                        fontSize={1}
                        mode="bleed"
                        onClick={() => setSuggestions({status: 'idle'})}
                        padding={2}
                        style={{marginRight: -8, marginTop: -6}}
                        text={t('todoSuggest.dismissAll')}
                      />
                    </Flex>
                    <Stack gap={5}>
                      {suggestions.items.map((suggestion, index) => (
                      // eslint-disable-next-line react/no-array-index-key -- stable per render: a suggestion is only ever added or dismissed, both of which remove it from `items` outright rather than reordering around it.
                      <Flex align="flex-start" gap={2} key={index}>
                        <Text muted size={0}>
                          <SparklesIcon />
                        </Text>
                        <Stack flex={1} gap={3} style={{maxWidth: '640px'}}>
                          <Text size={1} weight="semibold">
                            {suggestion.title}
                          </Text>
                          <Text muted size={1}>
                            {suggestion.reason}
                          </Text>
                          <Flex gap={2}>
                            {/* `marginLeft` cancels this button's
                                own padding — `tone="primary"`
                                gives it a visible background tint
                                even at rest (unlike the plain
                                `Dismiss` next to it), which
                                otherwise pushes its own text out
                                of line with the title/description
                                above. */}
                            <Button
                              fontSize={0}
                              mode="bleed"
                              onClick={() => handleAddSuggestion(index)}
                              padding={1}
                              style={{marginLeft: -4}}
                              text={t('todoSuggest.add')}
                              tone="primary"
                            />
                            <Button
                              fontSize={0}
                              mode="bleed"
                              onClick={() => handleDismissSuggestion(index)}
                              padding={1}
                              text={t('todoSuggest.dismiss')}
                            />
                          </Flex>
                        </Stack>
                      </Flex>
                      ))}
                    </Stack>
                  </Stack>
                )}
              </Stack>
            </Card>
          </AnimateIn>
        </Box>
      )}

      {/* "Find content gaps"' own result — same dismissible-card
          shape as Suggest todos just above (per-item dismiss,
          whole-card dismiss once items exist), one tier more
          speculative than either: every gap here is an AI's
          reading of a content survey, never a fact the way a
          broken reference or a failed validation rule is. */}
      {contentGaps &&
        (contentGapsResult.status === 'done' || contentGapsResult.status === 'error') && (
          <Box marginBottom={4}>
            <AnimateIn>
              <Card
                border
                paddingBottom={5}
                paddingTop={3}
                paddingX={4}
                radius={2}
                tone={contentGapsResult.status === 'error' ? 'critical' : 'primary'}
              >
                <Stack gap={3}>
                  {contentGapsResult.status === 'error' && (
                    <Flex align="flex-start" gap={3} justify="space-between">
                      <Text size={1}>{t('contentGaps.error')}</Text>
                      <Button
                        fontSize={1}
                        mode="bleed"
                        onClick={() => setContentGapsResult({status: 'idle'})}
                        padding={2}
                        text={t('contentGaps.dismiss')}
                      />
                    </Flex>
                  )}

                  {contentGapsResult.status === 'done' && contentGapsResult.items.length === 0 && (
                    <Flex align="flex-start" gap={3} justify="space-between">
                      <Text size={1}>{t('contentGaps.none')}</Text>
                      <Button
                        fontSize={1}
                        mode="bleed"
                        onClick={() => setContentGapsResult({status: 'idle'})}
                        padding={2}
                        text={t('contentGaps.dismiss')}
                      />
                    </Flex>
                  )}

                  {contentGapsResult.status === 'done' && contentGapsResult.items.length > 0 && (
                    <Stack gap={4}>
                      <Flex align="center" justify="space-between">
                        <Text size={1} weight="semibold">
                          {t('contentGaps.title')}
                        </Text>
                        <Button
                          fontSize={1}
                          mode="bleed"
                          onClick={() => setContentGapsResult({status: 'idle'})}
                          padding={2}
                          style={{marginRight: -8, marginTop: -6}}
                          text={t('contentGaps.dismissAll')}
                        />
                      </Flex>
                      <Stack gap={5}>
                        {contentGapsResult.items.map((gap, index) => (
                          // eslint-disable-next-line react/no-array-index-key -- stable per render: an item is only ever dismissed, which removes it from `items` outright rather than reordering around it.
                          <Flex align="flex-start" gap={2} key={index}>
                            <Text muted size={0}>
                              <SparklesIcon />
                            </Text>
                            <Stack flex={1} gap={3} style={{maxWidth: '640px'}}>
                              <Text size={1} weight="semibold">
                                {gap.title}
                              </Text>
                              <Text muted size={1}>
                                {gap.reason}
                              </Text>
                              <Flex gap={2}>
                                {/* `marginLeft` cancels this
                                    button's own padding — same
                                    fix `todoSuggest`'s per-item
                                    buttons already needed: a
                                    lone bleed button here is the
                                    leftmost thing in its own
                                    row, so its invisible
                                    padding otherwise pushes its
                                    text out of line with the
                                    title/reason directly above. */}
                                <Button
                                  fontSize={0}
                                  mode="bleed"
                                  onClick={() => dismissContentGap(index)}
                                  padding={1}
                                  style={{marginLeft: -4}}
                                  text={t('contentGaps.dismiss')}
                                />
                              </Flex>
                            </Stack>
                          </Flex>
                        ))}
                      </Stack>
                    </Stack>
                  )}
                </Stack>
              </Card>
            </AnimateIn>
          </Box>
        )}

      {/* A source's own `action` result (e.g. "Scan for issues")
          — same dismissible-card shape as Summarize/Suggest
          todos above, titled with the action's own label rather
          than a new i18n key, since that label is already
          whatever the source itself called this action. */}
      {actionSources.map((report) => {
        const {action} = report
        const result = actionResults[report.source.name]
        if (!action || !result) return null
        return (
          <Box key={report.source.name} marginBottom={4}>
            <AnimateIn>
              <Card
                border
                paddingBottom={5}
                paddingTop={3}
                paddingX={4}
                radius={2}
                tone={result.status === 'error' ? 'critical' : 'primary'}
              >
                <Stack gap={3}>
                  <Flex align="center" justify="space-between">
                    <Text size={1} weight="semibold">
                      {action.label}
                    </Text>
                    <Button
                      fontSize={1}
                      mode="bleed"
                      onClick={() => dismissActionResult(report.source.name)}
                      padding={2}
                      style={{marginRight: -8, marginTop: -6}}
                      text={t('sourceAction.dismiss')}
                    />
                  </Flex>
                  <Box style={{maxWidth: '640px'}}>
                    <Text size={1}>
                      {result.status === 'error' ? t('sourceAction.error') : result.message}
                    </Text>
                  </Box>
                </Stack>
              </Card>
            </AnimateIn>
          </Box>
        )
      })}
    </>
  )

  // `mainColumnResults` is a Fragment, always truthy even when every
  // condition inside it is false — `results && (...)` in `MergedList` can't
  // tell "nothing to show" from "something to show" off that alone, which
  // left an empty padded box rendering between the toolbar and the
  // checkbox row whenever no result was actually active. This mirrors the
  // same conditions `mainColumnResults` itself checks, so `MergedList`
  // gets `undefined` (not just an empty Fragment) when there's genuinely
  // nothing to render.
  const hasMainColumnResults =
    summary.status === 'done' ||
    summary.status === 'error' ||
    (Boolean(addTodo) && (suggestions.status === 'done' || suggestions.status === 'error')) ||
    (Boolean(contentGaps) &&
      (contentGapsResult.status === 'done' || contentGapsResult.status === 'error')) ||
    actionSources.some((report) => Boolean(report.action) && Boolean(actionResults[report.source.name]))

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
       * No border of its own, unlike an earlier version — the tab row right
       * beneath the headline reads as its own self-evident navigation
       * without one, and a single line under this whole block (headline,
       * tabs, and the global actions beside them together) mostly just
       * echoed the bordered card immediately below it, one pixel down.
       * `MergedList`'s own card (and `SectionCard`'s, for the aside column)
       * already draws that boundary, so this header stays edge-to-edge but
       * open beneath it.
       */}
      {/* Responsive on both axes, matching the content `Box` below (also
          `[3, 3, 4]` now) — the two used to disagree (this header stayed
          at a fixed 20px while the content dropped to 12px on mobile, or
          vice versa depending which was "fixed"), reading as misaligned
          edges. 12px on mobile isn't just cosmetic parity: narrow screens
          are the ones actually short on width, so the smaller inset is the
          one that should win everywhere, not 20px stretched down to every
          breakpoint. */}
      <Card padding={[3, 3, 4]}>
        <Stack gap={4}>
          <Flex align="flex-start" gap={3}>
            {/* Pulsing amber while something needs a look; a calm, static
                green once it doesn't — pulsing green would read as urgent,
                which contradicts "nothing waiting on you". `align="flex-start"`
                (not `center`) because the greeting can wrap to two lines on
                narrow screens — centering against the whole block sat the dot
                too low against the first line. The `translateY` nudges it
                back down from the row's own top edge to sit level with that
                first line's optical centre instead. */}
            <Box style={{transform: 'translateY(-6px)'}}>
              <StatusDot tone={openCount > 0 ? 'attention' : 'clear'} />
            </Box>
            <Heading size={1}>
              {/* First name of the actual viewer, not `headlineSubject`'s
                  own name — that one names whoever the assignee filter
                  currently picks out (could be a teammate), while this
                  greeting is always about the person looking at the
                  screen. `.name` is a full name (`CurrentUser`'s own
                  shape); only the first word reads as a greeting. */}
              {currentUser && t('inbox.greeting', {name: currentUser.name.split(' ')[0]})}
              {openCount === 0
                ? t(`inbox.allClear.${headlineSubject.kind}`, headlineSubject)
                : t(`inbox.waiting.${headlineSubject.kind}`, {count: openCount, ...headlineSubject})}
            </Heading>
          </Flex>

          {/* Tabs left, "Add content" flush right — same row, `wrap="wrap"`
              so a narrow phone drops it to a line of its own rather than
              squeezing both onto one. Every other pane-wide action
              (Summarize, Suggest todos, Scan, Add todo) lives one level
              down instead, in the main column's own toolbar — see
              `MergedList`'s `actions` doc comment for why. This one stays
              here because it's genuinely global (any document type, not
              scoped to the main column's own rows), the same reason it
              used to sit here before this session's toolbar move, and
              because a bare tab row otherwise reads as though something's
              missing beside it. */}
          <Flex align="center" gap={3} justify="space-between" wrap="wrap">
            <TabList gap={1}>
              <Tab
                aria-controls={PANEL_ID}
                fontSize={1}
                id={OPEN_TAB_ID}
                label={t('tab.open')}
                onClick={showOpen}
                selected={view === 'open'}
              />
              {/* Open, Snoozed, Cleared — the actual lifecycle order (active,
                  deferred, resolved), not the arbitrary order this used to
                  be in. */}
              <Tab
                aria-controls={PANEL_ID}
                fontSize={1}
                id={SNOOZED_TAB_ID}
                label={t('tab.snoozed')}
                onClick={showSnoozed}
                selected={view === 'snoozed'}
              />
              <Tab
                aria-controls={PANEL_ID}
                fontSize={1}
                id={CLEARED_TAB_ID}
                label={t('tab.cleared')}
                onClick={showCleared}
                selected={view === 'cleared'}
              />
            </TabList>
            <AddMenu />
          </Flex>
        </Stack>
      </Card>

      {main.map((source) => (
        <BoundedSourceFeed
          key={source.name}
          now={now}
          onReport={handleReport}
          snoozes={snoozes}
          source={source}
        />
      ))}

      {/* `paddingTop={0}`, not the uniform `padding={4}` this used to be: the
          header `Card` right above already contributes its own bottom
          padding, and the two stacked made the gap down to the list and
          Overview cards read as twice as far as every other gap in this
          layout (the inter-column gap, the outer left/right edges). Same
          responsive `[3, 3, 4]` horizontal inset as that header `Card`, not
          a fixed 20px — the two used to disagree at the mobile breakpoint. */}
      <Box paddingBottom={4} paddingTop={0} paddingX={[3, 3, 4]}>
        <Container width={4}>
          <TabPanel
            aria-labelledby={
              view === 'open' ? OPEN_TAB_ID : view === 'cleared' ? CLEARED_TAB_ID : SNOOZED_TAB_ID
            }
            id={PANEL_ID}
          >
            <ColumnsBoundary>
              <ResponsiveColumns>
                <Box>
                  <MergedList
                    actions={mainColumnActions}
                    ask={ask}
                    assessments={assessments}
                    assigneeFilter={assigneeFilter}
                    context={context}
                    dismissals={dismissals}
                    filterBar={filterBar}
                    maxHeight={sidebarHeight}
                    order={mainOrder}
                    reports={reports}
                    results={hasMainColumnResults ? mainColumnResults : undefined}
                    snoozes={snoozes}
                    typeFilter={typeFilter}
                    view={view}
                  />
                </Box>

                {/* Always rendered now, `InboxStats` first — the persistent
                    sidebar. Every aside source's own card is persistent too:
                    each one already draws its own "All clear."/"Nothing
                    snoozed." empty state internally, so there is no reason
                    left to hide the whole card while it has nothing due.
                    `ref` here is what `MergedList`'s own list height is
                    capped against — see `sidebarHeight` above. */}
                <Box ref={sidebarRef}>
                  <Stack gap={3}>
                    <InboxStats
                      assignableRows={assignableRows}
                      now={now}
                      openRows={openRows}
                      snoozed={snoozes.state.snoozed}
                      snoozedRows={snoozedRows}
                    />

                    {/* Always `view="open"`, never the pane's own tab: an
                        aside source offers no dismiss/snooze action of its
                        own (InboxSection dropped that whole mechanism for
                        aside content), so nothing can ever move a release
                        into Done or Snoozed through this UI — following the
                        Open/Done/Snoozed tabs here just meant Releases sat
                        showing "Nothing snoozed." on a tab that can never
                        hold anything, for every aside source there ever
                        is. */}
                    {aside.length > 0 && (
                      <Stack gap={3}>
                        {aside.map((source) => (
                          <BoundedSection
                            compact
                            dismissals={dismissals}
                            key={source.name}
                            onCount={ignoreCount}
                            snoozes={snoozes}
                            source={source}
                            view="open"
                          />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Box>
              </ResponsiveColumns>
            </ColumnsBoundary>
          </TabPanel>
        </Container>
      </Box>
    </Stack>
  )
}
