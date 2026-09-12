import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {useTodos} from './useTodos'

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

describe('useTodos', () => {
  it('keeps a todo added before the initial load resolves', async () => {
    const fetch = deferred<string | null>()
    const {client} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())

    act(() => result.current.add({title: 'Write the launch email'}))
    expect(result.current.state.items.map((item) => item.title)).toEqual(['Write the launch email'])

    fetch.resolve(null)
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    expect(result.current.state.items.map((item) => item.title)).toEqual(['Write the launch email'])
  })

  it('persists a todo once the load has settled', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
  })

  it('does not persist over a read it never actually saw', async () => {
    const {client, transaction} = mockClient(Promise.reject(new Error('network down')))
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useTodos())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    await new Promise((r) => setTimeout(r, 10))
    expect(transaction.commit).not.toHaveBeenCalled()
  })

  it('removes a todo for good', async () => {
    const {client} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))
    const id = result.current.state.items[0].id

    act(() => result.current.remove(id))
    expect(result.current.state.items).toEqual([])
  })
})
