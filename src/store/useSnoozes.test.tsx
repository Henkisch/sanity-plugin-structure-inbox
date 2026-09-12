import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {useSnoozes} from './useSnoozes'

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

describe('useSnoozes', () => {
  it('keeps a snooze made before the initial load resolves', async () => {
    const fetch = deferred<string | null>()
    const {client} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useSnoozes())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )
    expect(result.current.state.snoozed.tasks?.['task-1']).toBeTruthy()

    fetch.resolve(null)
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    expect(result.current.state.snoozed.tasks?.['task-1']).toBeTruthy()
  })

  it('persists a snooze once the load has settled', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useSnoozes())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
  })

  it('does not persist over a read it never actually saw', async () => {
    const {client, transaction} = mockClient(Promise.reject(new Error('network down')))
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useSnoozes())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )

    await new Promise((r) => setTimeout(r, 10))
    expect(transaction.commit).not.toHaveBeenCalled()
  })

  it('wakes an item, clearing its entry', async () => {
    const {client} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useSnoozes())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )
    expect(result.current.state.snoozed.tasks?.['task-1']).toBeTruthy()

    act(() => result.current.wake('tasks', 'task-1'))
    expect(result.current.state.snoozed.tasks?.['task-1']).toBeUndefined()
  })
})
