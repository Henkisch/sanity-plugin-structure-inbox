import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {of, Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS, withDismissal, type DismissalState} from '../../store/dismissals'
import {EMPTY_SNOOZES} from '../../store/snoozes'
import {resetWarnings} from '../../warnOnce'
import {mergeRows} from '../mergeItems'
import {type SourceReport} from '../SourceFeed'
import {splitItems} from '../splitItems'
import {type InboxItem} from '../types'
import {typeDisplayName, unpublishedDrafts} from './unpublishedDrafts'

interface DraftRow {
  _id: string
  _type: string
  _updatedAt: string
  title?: string
}

/**
 * A recency-ordered dataset-wide draft list, exactly like the real GROQ
 * query's `order(_updatedAt desc)[0...$limit]` would hand back — newest
 * first, sliced to whatever `$limit` the caller passed. This is what makes
 * the test actually exercise the over-fetch fix rather than merely inspect
 * params: a query that ignored `$limit` entirely would never reproduce the
 * bug this plan fixes.
 */
function makeRows(count: number, authoredIndices: Set<number>): DraftRow[] {
  return Array.from({length: count}, (_, i) => ({
    _id: `drafts.doc-${i}`,
    _type: 'post',
    _updatedAt: new Date(2026, 0, count - i).toISOString(),
    title: authoredIndices.has(i) ? 'mine' : 'not mine',
  }))
}

/** Transaction-history ndjson lines authored by `userId`, one per document id. */
function authoredLines(documentIds: string[], userId: string): string {
  return documentIds
    .map((id) =>
      JSON.stringify({
        id: `tx-${id}`,
        timestamp: '2026-09-01T00:00:00.000Z',
        author: userId,
        mutations: [],
        documentIDs: [id],
      }),
    )
    .join('\n')
}

function stubClient(allRows: DraftRow[], userId: string, authoredIds: string[]) {
  const observableFetch = vi.fn((_query: string, params: {limit: number}) =>
    of(allRows.slice(0, params.limit)),
  )
  const request = vi.fn().mockResolvedValue(authoredLines(authoredIds, userId))
  const prompt = vi.fn()

  const client = {
    config: () => ({dataset: 'production'}),
    observable: {fetch: observableFetch},
    listen: vi.fn(() => new Subject()),
    request,
    fetch: vi.fn().mockResolvedValue([]),
    // `useAgentClient` needs a real `.agent.action.prompt` function and a
    // `withConfig` to scope onto — present here (unlike the rest of this
    // stub) purely so `ai` unset can resolve to a defined `assess`/
    // `suggestSnooze`, the contrast the `ai: false` test below depends on.
    agent: {action: {prompt}},
    withConfig: () => client,
  } as unknown as SanityClient

  return {client, observableFetch, request, prompt}
}

/**
 * Just the fields `unpublishedDrafts.ts` actually reads off an assignable
 * user (`.granted`, `.displayName`, `.email`, `.imageUrl`, `.id`) — not the
 * full, `@beta` `UserWithPermission` shape, which needs a real Studio `User`
 * this test has no business constructing.
 */
interface StubAssignableUser {
  id: string
  displayName?: string
  email?: string
  imageUrl?: string
  granted: boolean
}

// A single stable reference, not a fresh object per render: `useDraftFetch`'s
// own `useMemo` depends on `[client, schema, userId]`, so a `useSchema` mock
// that returned a new object every call would recompute (and re-subscribe)
// the whole fetch pipeline on every render, forever.
const {useClientMock, stableSchema, useAssignableUsersMock} = vi.hoisted(() => {
  return {
    useClientMock: vi.fn(),
    stableSchema: {get: () => undefined},
    // A `vi.fn()`, not a plain arrow, so the `suggestAssignee` degradation
    // test below can override it to return a real, granted user for one test
    // and nothing else has to change: every other test still gets the same
    // `{data: undefined}` this returns by default. Typed explicitly (rather
    // than inferred from the default `{data: undefined}` literal) so
    // `mockReturnValue` can later be given a real user array.
    useAssignableUsersMock: vi.fn<() => {data: StubAssignableUser[] | undefined}>(() => ({data: undefined})),
  }
})

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useSchema: () => stableSchema,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
    useCurrentLocale: vi.fn(() => ({id: 'en-US'})),
  }
})

// Same reasoning as `assetIssues.proposeFix.test.tsx`'s own mock: assignment
// reaches Sanity's own `useUserListWithPermissions`, which needs a real
// Studio `source` context this test has no business standing up — none of
// these assertions are about assignment.
vi.mock('./capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capability')>()),
  useAssignableUsers: useAssignableUsersMock,
}))

afterEach(() => {
  // Same reasoning as `useDismissals.test.tsx`: `globals: false` means
  // `@testing-library/react`'s auto-cleanup never registers, so an unmount
  // has to happen explicitly or a hook's pending effects can leak into a
  // later test.
  cleanup()
  useClientMock.mockReset()
  // Restore the default `{data: undefined}` rather than `mockReset()`: the
  // latter would leave the mock with no implementation at all, and
  // `useItems()` destructures its return value unconditionally.
  useAssignableUsersMock.mockReturnValue({data: undefined})
})

describe('unpublishedDrafts onlyMine over-fetch', () => {
  it('still finds the user\'s own draft when it falls outside the naive limit window, but within the overfetch multiplier', async () => {
    // limit: 2 -> naive query would ask for [0...2]; the user's only draft
    // sits at index 4, well past that, but inside limit * 5 = 10.
    const allRows = makeRows(5, new Set([4]))
    const {client} = stubClient(allRows, 'user-1', ['drafts.doc-4'])
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 2})
    const {result} = renderHook(() => source.useOpenCount!(EMPTY_SNOOZES, Date.now()))

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toBe(1)
  })

  it('still caps the final list at limit even when more over-fetched rows than limit belong to the user', async () => {
    // limit: 3 -> raw fetch asks for [0...15]; all 15 rows are authored by
    // the current user, well more than `limit`.
    const allRows = makeRows(15, new Set(Array.from({length: 15}, (_, i) => i)))
    const {client} = stubClient(
      allRows,
      'user-1',
      allRows.map((row) => row._id),
    )
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 3})
    const {result} = renderHook(() => source.useOpenCount!(EMPTY_SNOOZES, Date.now()))

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toBe(3)
  })

  it('passes the query the over-fetched raw limit, not the option\'s own limit, when onlyMine is set', () => {
    const {client, observableFetch} = stubClient([], 'user-1', [])
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 4})
    renderHook(() => source.useOpenCount!(EMPTY_SNOOZES, Date.now()))

    expect(observableFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({limit: 20}))
  })

  it('leaves the raw fetch limit unchanged when onlyMine is off', () => {
    const {client, observableFetch} = stubClient([], 'user-1', [])
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: false, limit: 4})
    renderHook(() => source.useOpenCount!(EMPTY_SNOOZES, Date.now()))

    expect(observableFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({limit: 4}))
  })
})

// Plan 080: a failed `onlyMine` history read used to reach the outer
// `catchError` and turn the whole card into `{items: [], error}` — the
// filter's own failure, not the query's, costing the entire card. These
// assert the degradation instead: the enrichment (`onlyMine`, `suggestAssignee`)
// degrades, the underlying rows do not disappear.
describe('unpublishedDrafts — onlyMine degrades instead of erroring', () => {
  beforeEach(() => {
    resetWarnings()
  })

  afterEach(() => {
    cleanup()
    useClientMock.mockReset()
    useAssignableUsersMock.mockReturnValue({data: undefined})
  })

  it('still returns rows, with no error, when the onlyMine history read rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const allRows = makeRows(5, new Set([4]))
    const {client, request} = stubClient(allRows, 'user-1', ['drafts.doc-4'])
    request.mockRejectedValue(new Error('history endpoint unavailable'))
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 2})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    // The bug this plan fixes is exactly this combination: `{items: [], error}`.
    expect(result.current.items.length).toBeGreaterThan(0)
    expect(result.current.error).toBeUndefined()
  })

  it('caps the degraded fallback at limit, not the over-fetched raw limit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const allRows = makeRows(15, new Set())
    const {client, request} = stubClient(allRows, 'user-1', [])
    request.mockRejectedValue(new Error('history endpoint unavailable'))
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 3})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    expect(result.current.items.length).toBe(3)
  })

  it('warns once via warnOnce rather than spamming console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const allRows = makeRows(3, new Set())
    const {client, request} = stubClient(allRows, 'user-1', [])
    request.mockRejectedValue(new Error('history endpoint unavailable'))
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({onlyMine: true, limit: 2})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  // The happy path (filter succeeds) is already covered end to end by
  // `unpublishedDrafts onlyMine over-fetch` above — its first two `it`s
  // assert exact post-filter counts — so this block only adds the failure
  // path, not a duplicate of the success path.

  it('suggestAssignee resolves with no suggestion, rather than rejecting, when the author history read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useAssignableUsersMock.mockReturnValue({
      data: [{id: 'user-1', displayName: 'User One', email: 'user-1@example.com', granted: true}],
    })

    const allRows = makeRows(1, new Set())
    const {client, request} = stubClient(allRows, 'user-1', [])
    request.mockRejectedValue(new Error('history endpoint unavailable'))
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    expect(result.current.assign).toBeDefined()

    await expect(result.current.assign?.suggestAssignee?.(result.current.items[0])).resolves.toBeNull()
  })
})

// A draft with no title/name/label field at all used to show its raw `_id`
// as the row title (the query's own `coalesce()` fell back to `_id` before
// `toItem` ever saw a falsy value to catch). `typeDisplayName` is the
// friendlier fallback `toItem` now uses instead — see openTasks.test.ts's
// `dueSubtitleKey` for why this is tested as a pure function rather than
// through a full `useItems()` render.
describe('typeDisplayName', () => {
  it('uses the schema type\'s own title when one is registered', () => {
    const schema = {get: () => ({title: 'Blog post'})}
    expect(typeDisplayName(schema, 'post')).toBe('Blog post')
  })

  it('falls back to the raw type name when the schema has none, never the document id', () => {
    const schema = {get: () => undefined}
    expect(typeDisplayName(schema, 'post')).toBe('post')
  })
})

// The documented `ai: false` opt-out (`unpublishedDrafts.ts`'s own doc
// comment on the `ai` option: "every press spends an Agent Actions request,
// and a Studio should be able to turn that off") is implemented entirely by
// passing the flag through to `useAgentClient({enabled: ai})`. Nothing
// before plan 073 actually constructed `unpublishedDrafts({ai: false})` and
// asserted the paid extras come back `undefined` end to end.
describe('unpublishedDrafts — the `ai` opt-out', () => {
  afterEach(() => {
    cleanup()
    useClientMock.mockReset()
  })

  it('omits assess and suggestSnooze entirely when ai: false', async () => {
    const allRows = makeRows(1, new Set())
    const {client} = stubClient(allRows, 'user-1', [])
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({ai: false})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    expect(result.current.assess).toBeUndefined()
    expect(result.current.suggestSnooze).toBeUndefined()
  })

  it('offers assess and suggestSnooze when ai is left unset', async () => {
    const allRows = makeRows(1, new Set())
    const {client} = stubClient(allRows, 'user-1', [])
    useClientMock.mockReturnValue(client)

    const source = unpublishedDrafts({})
    const {result} = renderHook(() => source.useItems())

    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    expect(result.current.assess).toBeDefined()
    expect(result.current.suggestSnooze).toBeDefined()
  })
})

// Plan 075: the navbar badge (`useInboxOpenCount()` -> `useOpenCount`) and the
// pane headline (`mergeRows` over `report.open`) are two numbers an editor can
// see at the same time, and they used to be computed independently — the badge
// knew nothing about dismissals, so clearing five items moved the pane from 8
// to 3 while the badge sat at 8. These assert the two against each other
// rather than against a hardcoded expectation alone: a future change that
// moves one without the other fails here regardless of which way it moves.
describe('unpublishedDrafts — the badge agrees with the pane', () => {
  const NOW = Date.parse('2026-06-15T00:00:00.000Z')

  /**
   * Exactly what the pane does with one source's items: `SourceFeed` splits
   * them, `Inbox.tsx` counts the `'open'` rows `mergeRows` gives back.
   */
  function paneOpenCount(items: InboxItem[], dismissals: DismissalState): number {
    const {open, cleared, snoozed} = splitItems(items, 'unpublishedDrafts', EMPTY_SNOOZES, NOW)
    const report: SourceReport = {
      source: {name: 'unpublishedDrafts', title: 'Drafts', useItems: () => ({items: []})},
      open,
      cleared,
      snoozed,
    }
    return mergeRows({unpublishedDrafts: report}, ['unpublishedDrafts'], 'open', dismissals).length
  }

  /** Both numbers, from one render, for the same dismissal state. */
  function renderBoth(dismissals: DismissalState) {
    const source = unpublishedDrafts({limit: 10})
    return renderHook(() => ({
      items: source.useItems().items,
      badge: source.useOpenCount!(EMPTY_SNOOZES, NOW, dismissals),
    }))
  }

  afterEach(() => {
    cleanup()
    useClientMock.mockReset()
  })

  it('both report every draft when nothing is dismissed', async () => {
    const {client} = stubClient(makeRows(3, new Set()), 'user-1', [])
    useClientMock.mockReturnValue(client)

    const {result} = renderBoth(EMPTY_DISMISSALS)
    await waitFor(() => expect(result.current.items.length).toBe(3))

    expect(result.current.badge).toBe(paneOpenCount(result.current.items, EMPTY_DISMISSALS))
    expect(result.current.badge).toBe(3)
  })

  it('both drop to 1 when two of three drafts are dismissed', async () => {
    const {client} = stubClient(makeRows(3, new Set()), 'user-1', [])
    useClientMock.mockReturnValue(client)

    // After every row's own `_updatedAt` (January 2026), so neither is stale.
    const at = '2026-06-01T00:00:00.000Z'
    let dismissals = withDismissal(EMPTY_DISMISSALS, 'unpublishedDrafts', 'drafts.doc-0', at)
    dismissals = withDismissal(dismissals, 'unpublishedDrafts', 'drafts.doc-1', at)

    const {result} = renderBoth(dismissals)
    await waitFor(() => expect(result.current.items.length).toBe(3))

    expect(result.current.badge).toBe(paneOpenCount(result.current.items, dismissals))
    // The regression itself: this used to be 3 while the pane said 1.
    expect(result.current.badge).toBe(1)
  })

  it('neither counts a stale dismissal — an edit after the tick puts the row back', async () => {
    const {client} = stubClient(makeRows(3, new Set()), 'user-1', [])
    useClientMock.mockReturnValue(client)

    // Before every row's own `_updatedAt`, so `isDismissed` calls it stale.
    const dismissals = withDismissal(
      EMPTY_DISMISSALS,
      'unpublishedDrafts',
      'drafts.doc-0',
      '2025-01-01T00:00:00.000Z',
    )

    const {result} = renderBoth(dismissals)
    await waitFor(() => expect(result.current.items.length).toBe(3))

    expect(result.current.badge).toBe(paneOpenCount(result.current.items, dismissals))
    expect(result.current.badge).toBe(3)
  })

  it('neither counts another source\'s dismissal of the same item id', async () => {
    const {client} = stubClient(makeRows(3, new Set()), 'user-1', [])
    useClientMock.mockReturnValue(client)

    const dismissals = withDismissal(
      EMPTY_DISMISSALS,
      'someOtherSource',
      'drafts.doc-0',
      '2026-06-01T00:00:00.000Z',
    )

    const {result} = renderBoth(dismissals)
    await waitFor(() => expect(result.current.items.length).toBe(3))

    expect(result.current.badge).toBe(paneOpenCount(result.current.items, dismissals))
    expect(result.current.badge).toBe(3)
  })
})
