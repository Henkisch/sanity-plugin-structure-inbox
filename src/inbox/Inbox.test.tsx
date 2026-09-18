import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {ToastProvider} from '@sanity/ui/toast'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {renderWithTheme} from '../test/renderWithTheme'
import {BoundedSection, BoundedSourceFeed, Inbox} from './Inbox'
import {type SourceReport} from './SourceFeed'
import {type InboxSource} from './types'

// Real, minimal content-type schema — one document type, one string field
// — enough for `surveyContentTypes` (via `getProjectDigest`) to issue a
// real `count()` (and, once it sees documents, a real sample) fetch
// through `clientFetchMock` below. Same `isDocumentSchemaType`-satisfying
// shape `projectDigest.test.ts`'s own `schemaWith` helper already
// established.
const SURVEYABLE_SCHEMA = {
  getTypeNames: () => ['post'],
  get: (name: string) =>
    name === 'post'
      ? {
          name: 'post',
          title: 'Post',
          fields: [{name: 'title', type: {jsonType: 'string'}}],
          jsonType: 'object',
          type: {name: 'document'},
        }
      : undefined,
} as never

const DEFAULT_SCHEMA = {getTypeNames: () => [], get: () => undefined} as never

const {useAgentClientMock, promptJsonMock, clientFetchMock, useSchemaMock} = vi.hoisted(() => ({
  useAgentClientMock: vi.fn(() => ({}) as never),
  promptJsonMock: vi.fn(),
  clientFetchMock: vi.fn(),
  useSchemaMock: vi.fn(),
}))

// `Inbox` itself (unlike `BoundedSection`/`BoundedSourceFeed` above) calls
// `useClient`, `useSchema`, `useCurrentUser`, `useSharedInboxStore` (via
// `../studio/inboxCountLayout`) and `useAgentClient` — a full Studio source
// context this suite does not build. Same mocking shape MergedList.test.tsx
// already established for the `sanity`/`useAgentClient`/`promptJson` half of
// this; `useClient`/`useSchema` and `../studio/inboxCountLayout` are the two
// additions `Inbox` itself needs beyond what rendering `MergedList` alone
// does. `useClient`/`useSchema` are real `vi.fn()`s (not fixed arrows), so
// the `getProjectDigest` cache tests below can supply a real, surveyable
// schema and assert against `clientFetchMock`'s own call count.
vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useRelativeTime: () => 'a while ago',
    useCurrentUser: () => null,
    useClient: () => ({fetch: clientFetchMock}) as never,
    // `AddMenu` (always mounted alongside `mainColumnActions`, regardless of
    // whether any source actually offers `create`) calls `schema.getTypeNames()`
    // unconditionally — a bare `{}` stub throws there before this suite ever
    // reaches the AI-insights menu it's actually testing.
    useSchema: useSchemaMock,
  }
})

vi.mock('../ai/useAgentClient', () => ({useAgentClient: useAgentClientMock}))
vi.mock('../ai/promptJson', () => ({promptJson: promptJsonMock}))

// Stands in for the plugin's always-mounted layout provider (see
// `useSharedInboxStore`'s own doc comment in `../studio/inboxCountLayout` —
// `Inbox` throws without it, and the real provider itself needs a full
// Studio source context to mount its own `useDismissals`/`useSnoozes`).
vi.mock('../studio/inboxCountLayout', () => ({
  useSharedInboxStore: () => ({
    dismissals: {state: EMPTY_DISMISSALS, dismiss: vi.fn(), restore: vi.fn()},
    snoozes: {state: EMPTY_SNOOZES, snooze: vi.fn(), wake: vi.fn()},
  }),
}))

// `vitest.config.ts`'s own global `restoreMocks: true` calls
// `mockRestore()` on every `vi.fn()` before each test — including
// `useSchemaMock`, which (unlike `useAgentClientMock`, created with an
// initial `vi.fn(() => ({}))` implementation that survives a restore)
// has no implementation of its own, so a restore leaves it returning
// `undefined` rather than reverting to a prior `mockReturnValue`. Setting
// the default here, in `beforeEach` (which runs after that global
// restore), is what actually makes it stick for every test that doesn't
// override it.
beforeEach(() => {
  useSchemaMock.mockReturnValue(DEFAULT_SCHEMA)
})

afterEach(() => {
  cleanup()
})

/**
 * `Inbox` itself calls `useDismissals`, which calls `useClient` and needs a
 * full Studio source context to mount — more than a unit test for the error
 * boundary should have to carry. `BoundedSection` is the piece that actually
 * wires the boundary around `InboxSection`, and it only needs `dismissals` as
 * a plain prop, so it is rendered directly here instead, per the plan's
 * fallback: the smallest thing that proves a throwing source is contained.
 */
const dismissals: Dismissals = {
  state: EMPTY_DISMISSALS,
  dismiss: () => {},
  restore: () => {},
}

const snoozes: Snoozes = {
  state: EMPTY_SNOOZES,
  snooze: () => {},
  wake: () => {},
}

const theme = buildTheme()

function renderSections(sources: InboxSource[]) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        {sources.map((source) => (
          <BoundedSection
            dismissals={dismissals}
            key={source.name}
            onCount={() => {}}
            snoozes={snoozes}
            source={source}
            view="open"
          />
        ))}
      </ToastProvider>
    </ThemeProvider>,
  )
}

function workingSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => ({items: []}),
  }
}

function throwingSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => {
      throw new Error(`${name} blew up`)
    },
  }
}

function reportedErrorSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => ({items: [], error: new Error(`${name} reported`)}),
  }
}

describe('BoundedSection', () => {
  it('contains a throwing source to its own card, leaving its sibling rendered', () => {
    // The boundary logs the caught error via console.error; that is expected
    // noise from this test, not a failure to surface.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderSections([throwingSource('bad', 'Bad Source'), workingSource('good', 'Good Source')])

    // The throwing source gets an error card of its own, not a blank pane.
    expect(screen.getByText('Bad Source')).toBeTruthy()
    expect(screen.getByText('bad blew up')).toBeTruthy()

    // Its sibling is unaffected — this is the regression: before the fix, the
    // throw unwinds past both sections, and the whole pane crashes.
    expect(screen.getByText('Good Source')).toBeTruthy()
  })

  it('still renders the existing error card for a source that reports an error', () => {
    renderSections([reportedErrorSource('flaky', 'Flaky Source')])

    expect(screen.getByText('Flaky Source')).toBeTruthy()
    expect(screen.getByText('flaky reported')).toBeTruthy()
  })
})

function renderFeeds(
  sources: InboxSource[],
  onReport: (name: string, report: SourceReport) => void,
) {
  return render(
    <ThemeProvider theme={theme}>
      {sources.map((source) => (
        <BoundedSourceFeed
          key={source.name}
          now={Date.now()}
          onReport={onReport}
          snoozes={snoozes}
          source={source}
        />
      ))}
    </ThemeProvider>,
  )
}

describe('BoundedSourceFeed', () => {
  it('reports an error instead of throwing past the boundary, leaving its sibling reporting normally', () => {
    // The boundary logs the caught error via console.error; expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReport = vi.fn()

    renderFeeds(
      [throwingSource('bad', 'Bad Source'), workingSource('good', 'Good Source')],
      onReport,
    )

    expect(onReport).toHaveBeenCalledWith(
      'bad',
      expect.objectContaining({error: expect.any(Error)}),
    )
    expect(onReport).toHaveBeenCalledWith(
      'good',
      expect.objectContaining({open: [], cleared: [], snoozed: []}),
    )
  })
})

// Stable references, not created fresh inside `useItems` below: a real
// source (`todos.ts`) keeps its own `items` array reference stable across
// renders via its own internal state/memoization, the same way `useState`
// or `useMemo` would. A literal `{items: []}` returned fresh on every call
// does not — `SourceFeed`'s own report effect depends on `open`/`cleared`/
// `snoozed` (derived from `items`), so a new array each render re-fires
// that effect, which calls `onReport`, which (only once wired to the real
// `Inbox`, unlike `BoundedSection`/`BoundedSourceFeed` above) sets state on
// `Inbox` itself and re-renders it — an infinite loop, confirmed live
// ("Maximum update depth exceeded") before this was hoisted out.
const TODOS_ITEMS: never[] = []
const TODOS_CREATE = vi.fn()

function todosSource(): InboxSource {
  // `handleSuggestTodos`'s own trigger (`addTodo = reports.todos?.create`,
  // in `Inbox.tsx`) only renders once some `main` source named exactly
  // `todos` reports a `create` — this is that source, standing in for the
  // real `todos.ts` built-in.
  return {name: 'todos', title: 'Todos', useItems: () => ({items: TODOS_ITEMS, create: TODOS_CREATE})}
}

function openAiInsightsMenu() {
  // No real i18next instance in this suite (see the same `t()`-returns-the-
  // raw-key behaviour `MergedList.test.tsx` already relies on for its own
  // `getByRole(..., {name: 'action.assign'})`-style queries) — so the
  // accessible name is the untranslated key, not the English copy.
  fireEvent.click(screen.getByRole('button', {name: 'inbox.aiInsightsMenu'}))
}

describe('Inbox handleSuggestTodos', () => {
  // Plan 044 (revised): this used to be Plan 032's own "keeps the later
  // request's result even when the earlier request resolves last" test — it
  // fired two clicks inside one `act()` and asserted `promptJsonMock` was
  // called *twice*, then resolved the two requests out of order to prove
  // the later one's result won. That premise no longer holds: since
  // `handleSuggestTodos`'s own `suggestTodosInFlightRef` (a plain ref,
  // mutated synchronously, not through `setState`) now gates the request
  // itself — not just a `suggestions.status === 'loading'` state read, which
  // is stale for both clicks in the same batch and would let both through —
  // a second click landing in the very same React batch as the first is
  // now a genuine no-op: there is no longer a second real request for a
  // second, later response to ever race against. This test now proves
  // that directly, the same technique Plan 032's test used (two
  // `fireEvent.click` calls inside one `act()`), with the assertion updated
  // to match: exactly one call, not two.
  //
  // `suggestTodosRequestRef` (the original bump-then-compare ref) still
  // exists alongside `suggestTodosInFlightRef` as defense-in-depth — see
  // `Inbox.tsx`'s own comment on `handleSummarize` for why the two refs
  // guard different things — but with the in-flight ref now closing the
  // request-level race, there is no longer a reachable path in this
  // component to construct two genuinely concurrent requests whose
  // responses could land out of order, so that defense-in-depth is not
  // separately exercised here.
  it('calls promptJson only once even when both clicks land in the same React batch', async () => {
    let resolvePrompt!: (value: {items: {title: string; reason: string}[]}) => void
    promptJsonMock.mockImplementation(() => new Promise((resolve) => (resolvePrompt = resolve)))

    renderWithTheme(<Inbox sources={[todosSource()]} />)

    openAiInsightsMenu()
    const suggestTodosItem = screen.getByRole('menuitem', {name: /todoSuggest\.ask/})

    act(() => {
      fireEvent.click(suggestTodosItem)
      fireEvent.click(suggestTodosItem)
    })

    expect(promptJsonMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePrompt({items: [{title: 'Only suggestion', reason: 'because only'}]})
      await Promise.resolve()
    })

    expect(await screen.findByText('Only suggestion')).toBeTruthy()
  })

  // Plan 044: two *separate*, individually-flushed clicks (the realistic
  // shape of a rapid double-click, unlike the single-`act()` race above) —
  // `promptJson` still runs only once. This exact path was already covered
  // before this plan by the trigger's own `disabled={suggestions.status
  // === 'loading'}` (Plan 032), so it doesn't independently prove this
  // plan's own guard on its own — see the same-tick case above for the one
  // that does. This case still guards the combined, real-world behavior
  // (and is the same regression test shape that *does* catch a dropped
  // guard for `AskInbox`'s Enter-key path and `InboxRow`'s
  // `handleAssess`/`handleProposeFix`, which have no such pre-existing
  // `disabled` wiring of their own).
  it('calls promptJson only once for two separate clicks on the same trigger', async () => {
    let resolvePrompt!: (value: {items: never[]}) => void
    promptJsonMock.mockImplementation(() => new Promise((resolve) => (resolvePrompt = resolve)))

    renderWithTheme(<Inbox sources={[todosSource()]} />)

    openAiInsightsMenu()
    const suggestTodosItem = screen.getByRole('menuitem', {name: /todoSuggest\.ask/})
    fireEvent.click(suggestTodosItem)
    fireEvent.click(suggestTodosItem)

    expect(promptJsonMock).toHaveBeenCalledTimes(1)
    resolvePrompt({items: []})
  })
})

// Plan 045: `summarize`/`suggestTodos` are the config-level opt-outs for
// these two pane-wide AI reads — both default to `true` (today's existing,
// unconditional behaviour), so the regression case is that omitting them
// entirely changes nothing.
describe('Inbox summarize/suggestTodos opt-out', () => {
  it('shows both Summarize and Suggest todos by default, with neither prop passed', () => {
    renderWithTheme(<Inbox sources={[todosSource()]} />)

    openAiInsightsMenu()

    expect(screen.getByRole('menuitem', {name: /summarize\.ask/})).toBeTruthy()
    expect(screen.getByRole('menuitem', {name: /todoSuggest\.ask/})).toBeTruthy()
  })

  it('hides the Summarize menu item entirely when summarize={false}', () => {
    renderWithTheme(<Inbox sources={[todosSource()]} summarize={false} />)

    openAiInsightsMenu()

    expect(screen.queryByRole('menuitem', {name: /summarize\.ask/})).toBeNull()
    // Suggest todos is unaffected — the two flags are independent.
    expect(screen.getByRole('menuitem', {name: /todoSuggest\.ask/})).toBeTruthy()
  })

  it('hides the Suggest todos menu item entirely when suggestTodos={false}, even with a todos source configured', () => {
    renderWithTheme(<Inbox sources={[todosSource()]} suggestTodos={false} />)

    openAiInsightsMenu()

    expect(screen.queryByRole('menuitem', {name: /todoSuggest\.ask/})).toBeNull()
    // Summarize is unaffected — the two flags are independent.
    expect(screen.getByRole('menuitem', {name: /summarize\.ask/})).toBeTruthy()
  })
})

// Plan 042: `getProjectDigest` (`Inbox.tsx`) is the short-TTL-cached survey
// shared between "Find content gaps" and Ask — these cases prove the cache
// itself, not `surveyContentTypes`'s own per-type behaviour (already
// covered in `projectDigest.test.ts`).
describe('Inbox getProjectDigest cache', () => {
  it('shares one survey between Find content gaps and Ask within the TTL window', async () => {
    useSchemaMock.mockReturnValue(SURVEYABLE_SCHEMA)
    // One real content type (`post`) — `count()` then a text sample, the
    // only two fetches one full `surveyContentTypes` run makes here.
    clientFetchMock.mockResolvedValueOnce(2).mockResolvedValueOnce(['Doc A', 'Doc B'])
    promptJsonMock.mockResolvedValue({keys: [], reason: 'no match', gaps: []})

    renderWithTheme(<Inbox ask contentGaps={{}} sources={[todosSource()]} />)

    openAiInsightsMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: /contentGaps\.ask/}))

    // The first read runs the real survey: exactly the count + sample
    // fetch for the one surveyable type.
    await waitFor(() => expect(promptJsonMock).toHaveBeenCalledTimes(1))
    expect(clientFetchMock).toHaveBeenCalledTimes(2)

    // Ask, submitted right after — well within `PROJECT_DIGEST_TTL_MS` —
    // should reuse the cached survey rather than running a second one.
    fireEvent.change(screen.getByPlaceholderText('ask.placeholder'), {
      target: {value: 'anything about the spring campaign'},
    })
    fireEvent.click(screen.getByRole('button', {name: 'ask.submit'}))

    await waitFor(() => expect(promptJsonMock).toHaveBeenCalledTimes(2))
    // Still 2, not 4: Ask's own read never re-ran `surveyContentTypes`.
    expect(clientFetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the cache on a rejected survey instead of replaying the same rejection', async () => {
    useSchemaMock.mockReturnValue(SURVEYABLE_SCHEMA)
    clientFetchMock.mockRejectedValueOnce(new Error('network down'))

    renderWithTheme(<Inbox contentGaps={{}} sources={[todosSource()]} />)

    openAiInsightsMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: /contentGaps\.ask/}))

    // The failed survey fails this whole read (unlike Ask's own optional
    // fallback) — `handleFindContentGaps` has no content without it.
    await waitFor(() => expect(clientFetchMock).toHaveBeenCalledTimes(1))
    expect(promptJsonMock).not.toHaveBeenCalled()

    // A second attempt, right after — still well within the TTL window —
    // must retry the survey rather than reuse the remembered rejection.
    // Same still-open menu as before — selecting an item doesn't close
    // this `MenuButton` (the same reason `handleSuggestTodos`'s own test
    // above clicks its item twice without reopening in between); a second
    // `openAiInsightsMenu()` call here would instead *toggle it closed*.
    clientFetchMock.mockResolvedValueOnce(2).mockResolvedValueOnce(['Doc A'])
    promptJsonMock.mockResolvedValue({gaps: []})

    // Reopening this `MenuButton` a second time (rather than reusing the
    // still-open one, which the first item's own selection already
    // closed) leaves its popover content out of the accessibility tree
    // in this jsdom environment even once reopened (`aria-expanded`
    // flips back to `true`, but the popover panel itself keeps a stale
    // `hidden` attribute) — `hidden: true` looks past that; the item is
    // genuinely present and clickable underneath, same as a real reopen.
    openAiInsightsMenu()
    fireEvent.click(screen.getByRole('menuitem', {hidden: true, name: /contentGaps\.ask/}))

    await waitFor(() => expect(promptJsonMock).toHaveBeenCalledTimes(1))
    // 1 (rejected) + 2 (count + sample on retry) = 3, not stuck at 1.
    expect(clientFetchMock).toHaveBeenCalledTimes(3)
  })

})

describe('Inbox source stability', () => {
  // The real thing, end to end: a source written the way the README documents
  // — items built fresh inside `useItems`, nothing memoized — mounted in the
  // actual `Inbox`, whose `handleReport` stores what `SourceFeed` reports.
  // Before `useStableItems`, this combination was an unbounded render loop
  // that took a customer's Structure tool down with "Maximum update depth
  // exceeded". It renders the row instead.
  it('survives a source that rebuilds its items on every render', () => {
    const churning: InboxSource = {
      name: 'churning',
      title: 'Churning',
      useItems: () => ({
        items: [
          {
            id: 'sub-1',
            title: 'An unanswered enquiry',
            subtitle: 'Contact form',
            timestamp: '2026-09-18T08:00:00.000Z',
            intent: {type: 'edit', params: {id: 'sub-1', type: 'contactSubmission'}},
          },
        ],
      }),
    }

    renderWithTheme(<Inbox sources={[churning]} />)

    expect(screen.getByText('An unanswered enquiry')).toBeTruthy()
  })
})
