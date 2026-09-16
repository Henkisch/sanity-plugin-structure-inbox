import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {of, Subject} from 'rxjs'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_SNOOZES} from '../../store/snoozes'
import {unpublishedDrafts} from './unpublishedDrafts'

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

  const client = {
    config: () => ({dataset: 'production'}),
    observable: {fetch: observableFetch},
    listen: vi.fn(() => new Subject()),
    request,
  } as unknown as SanityClient

  return {client, observableFetch, request}
}

// A single stable reference, not a fresh object per render: `useDraftFetch`'s
// own `useMemo` depends on `[client, schema, userId]`, so a `useSchema` mock
// that returned a new object every call would recompute (and re-subscribe)
// the whole fetch pipeline on every render, forever.
const {useClientMock, stableSchema} = vi.hoisted(() => ({
  useClientMock: vi.fn(),
  stableSchema: {get: () => undefined},
}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useSchema: () => stableSchema,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
  }
})

afterEach(() => {
  // Same reasoning as `useDismissals.test.tsx`: `globals: false` means
  // `@testing-library/react`'s auto-cleanup never registers, so an unmount
  // has to happen explicitly or a hook's pending effects can leak into a
  // later test.
  cleanup()
  useClientMock.mockReset()
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
