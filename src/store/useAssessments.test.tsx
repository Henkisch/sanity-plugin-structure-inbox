import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {useAssessments} from './useAssessments'

/** Same as `useDismissals.test.tsx`'s own — holds `fetch` open so a test can assert what happens *while* a load is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

function fakeTransaction() {
  const commit = vi.fn().mockResolvedValue(undefined)
  const stub = {
    createIfNotExists: vi.fn(() => stub),
    patch: vi.fn(() => stub),
    commit,
  }
  return stub
}

function mockClient(fetchResult: Promise<string | null>) {
  const transaction = fakeTransaction()
  const client = {
    fetch: vi.fn().mockReturnValue(fetchResult),
    transaction: vi.fn(() => transaction),
  }
  return {client, transaction}
}

const {useClientMock} = vi.hoisted(() => ({useClientMock: vi.fn()}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
  }
})

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
})

describe('useAssessments', () => {
  it('keeps a cache write made before the initial load resolves', async () => {
    const fetch = deferred<string | null>()
    const {client} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useAssessments())

    act(() => result.current.write('drafts', 'item-1', {message: 'Looks ready.'}, '2026-06-01T00:00:00.000Z'))
    expect(result.current.read('drafts', 'item-1', '2026-06-01T00:00:00.000Z')).toEqual({message: 'Looks ready.'})

    // The load resolving late — with nothing stored — must not wipe out the
    // write that already happened.
    fetch.resolve(null)
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    expect(result.current.read('drafts', 'item-1', '2026-06-01T00:00:00.000Z')).toEqual({message: 'Looks ready.'})
  })

  it('persists a write once the load has settled', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useAssessments())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.write('drafts', 'item-1', {message: 'Looks ready.'}, '2026-06-01T00:00:00.000Z'))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
  })

  it('does not persist over a read it never actually saw', async () => {
    const {client, transaction} = mockClient(Promise.reject(new Error('network down')))
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useAssessments())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.write('drafts', 'item-1', {message: 'Looks ready.'}, '2026-06-01T00:00:00.000Z'))

    await new Promise((r) => setTimeout(r, 10))
    expect(transaction.commit).not.toHaveBeenCalled()
  })

  it('retries a failed write the next time the persist effect runs, instead of silently dropping it', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    transaction.commit = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue(undefined)
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result, rerender} = renderHook(() => useAssessments())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.write('drafts', 'item-1', {message: 'Looks ready.'}, '2026-06-01T00:00:00.000Z'))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(console.error).toHaveBeenCalled())

    // Nothing about the assessments state changes here — only `client`'s
    // identity does, standing in for any future unrelated reason the persist
    // effect might re-run. The load effect's own re-fetch is made to hang
    // forever so it cannot itself cause a second state change and confound
    // what's being tested: whether the *previously failed* write is retried.
    // If the failed commit had wrongly cleared `dirtyRef`, this second run
    // would skip the write entirely instead of retrying it.
    useClientMock.mockReturnValue({
      fetch: vi.fn().mockReturnValue(new Promise(() => {})),
      transaction: client.transaction,
    })
    rerender()

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(2))
  })

  it('does nothing at all when changedAt is undefined — never caches, never persists', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useAssessments())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.write('drafts', 'item-1', {message: 'Looks ready.'}, undefined))

    expect(result.current.read('drafts', 'item-1', undefined)).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(transaction.commit).not.toHaveBeenCalled()
  })
})
