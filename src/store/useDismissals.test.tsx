import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {useDismissals} from './useDismissals'

/**
 * A promise plus its resolver/rejecter, so a test can hold `fetch` open and
 * settle it at a chosen point — the whole reason these tests exist is to
 * assert what happens *while a fetch is in flight*.
 */
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

// Hoisted, and kept separate from the real `sanity.useClient` binding, so
// referencing it here never resolves to that export's deprecated no-args
// overload (`useClient()` without an apiVersion) and trips the lint rule that
// guards against it.
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
  // `vitest.config.ts` sets `globals: false`, so `@testing-library/react`'s
  // auto-cleanup never registers. Without an explicit unmount, a hook's
  // pending effects (the load `.then`, the persist effect) can still fire
  // during a *later* test, throwing against that test's already-reset mocks.
  cleanup()
  useClientMock.mockReset()
})

describe('useDismissals', () => {
  it('keeps a dismissal made before the initial load resolves', async () => {
    const fetch = deferred<string | null>()
    const {client} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useDismissals())

    act(() => result.current.dismiss('tasks', 'task-1'))
    expect(result.current.state.dismissed.tasks?.['task-1']).toBeTruthy()

    // The fetch resolving late — with nothing stored — must not wipe out the
    // tick that already happened. It merges rather than replaces.
    fetch.resolve(null)
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    expect(result.current.state.dismissed.tasks?.['task-1']).toBeTruthy()
  })

  it('persists a dismissal once the load has settled', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useDismissals())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.dismiss('tasks', 'task-1'))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
  })

  it('does not persist over a read it never actually saw', async () => {
    const {client, transaction} = mockClient(Promise.reject(new Error('network down')))
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useDismissals())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.dismiss('tasks', 'task-1'))

    // Give the persist effect a tick it could have fired in, then confirm it
    // did not: `loadedRef` never settled, so writing now would risk
    // overwriting server state this session never read.
    await new Promise((r) => setTimeout(r, 10))
    expect(transaction.commit).not.toHaveBeenCalled()
  })

  it('retries a failed write the next time the persist effect runs, instead of silently dropping it', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    transaction.commit = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue(undefined)
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result, rerender} = renderHook(() => useDismissals())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.dismiss('tasks', 'task-1'))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(console.error).toHaveBeenCalled())

    // Nothing about the dismissed state changes here — only `client`'s
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
})
