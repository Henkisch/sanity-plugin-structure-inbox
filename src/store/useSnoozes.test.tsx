import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {parseSnoozes} from './snoozes'
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
  // Captures what the real `(patch) => patch.set({...})` callback the hook
  // passes actually built, so a test can assert on the payload rather than
  // just on `commit` having been called at all.
  let patchedFields: Record<string, unknown> | undefined
  const patchHandle = {
    set: (fields: Record<string, unknown>) => {
      patchedFields = fields
      return patchHandle
    },
  }
  const stub = {
    createIfNotExists: vi.fn((_doc: {_id: string; _type: string} & Record<string, unknown>) => stub),
    patch: vi.fn((_id: string, patchFn: (p: typeof patchHandle) => unknown) => {
      patchFn(patchHandle)
      return stub
    }),
    commit,
    get patchedFields() {
      return patchedFields
    },
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

const {useClientMock, useCurrentUserMock} = vi.hoisted(() => ({
  useClientMock: vi.fn(),
  // A hoisted mock rather than an inline `vi.fn(() => ({id: 'user-1'}))`, so
  // a test can override which editor is "current" — needed to prove two
  // different editors get two different document ids.
  useCurrentUserMock: vi.fn(() => ({id: 'user-1'})),
}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useCurrentUser: useCurrentUserMock,
  }
})

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
  // Restore the default editor identity for every other test in the file —
  // only the distinct-id test below ever changes it.
  useCurrentUserMock.mockReset()
  useCurrentUserMock.mockImplementation(() => ({id: 'user-1'}))
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

  it('keeps a "Wake now" made before a late load resolves, instead of resurrecting the snooze', async () => {
    // The regression this plan exists for: the server still has the item
    // snoozed (from before this mount, still active), the editor wakes it
    // locally, and then the in-flight load resolves with that stale snoozed
    // value. A pure-union merge would put it right back.
    const fetch = deferred<string | null>()
    const {client} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const {result} = renderHook(() => useSnoozes())

    act(() => result.current.snooze('tasks', 'task-1', until))
    act(() => result.current.wake('tasks', 'task-1'))
    expect(result.current.state.snoozed.tasks?.['task-1']).toBeUndefined()

    // The stale server value: set before the local wake.
    const staleServerValue = JSON.stringify({
      version: 1,
      snoozed: {tasks: {'task-1': {at: '2020-01-01T00:00:00.000Z', until}}},
    })
    fetch.resolve(staleServerValue)
    // Await the promise itself, not just `waitFor(client.fetch called)` —
    // that's already true from the initial mount and would let this
    // assertion race ahead of the merge's `.then()` actually running.
    await act(async () => {
      await fetch.promise
    })

    expect(result.current.state.snoozed.tasks?.['task-1']).toBeUndefined()
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

    // The real shape: a per-editor document id derived from the user id, and
    // the (unregistered) document type this hook writes. Hardcoded rather
    // than recomputed the way the implementation builds it, so a dropped
    // user suffix — every editor colliding on one shared document — would
    // actually fail this assertion instead of passing along with it.
    expect(transaction.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'structureInbox.snoozes.user-1',
        _type: 'structureInbox.snoozes',
      }),
    )

    // The payload round-trips: what the hook sent to `patch.set(...)` parses
    // back into exactly the state `snooze()` produced.
    const patchedValue = transaction.patchedFields?.snoozed
    expect(typeof patchedValue).toBe('string')
    expect(parseSnoozes(JSON.parse(patchedValue as string))).toEqual(result.current.state)
  })

  it('writes to a document id unique to this editor, never a shared one', async () => {
    useCurrentUserMock.mockReturnValue({id: 'user-1'})
    const {client: clientA, transaction: transactionA} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(clientA)

    const {result: resultA, unmount: unmountA} = renderHook(() => useSnoozes())
    await waitFor(() => expect(clientA.fetch).toHaveBeenCalled())
    act(() =>
      resultA.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )
    await waitFor(() => expect(transactionA.commit).toHaveBeenCalledTimes(1))
    const idA = (transactionA.createIfNotExists.mock.calls[0][0] as {_id: string})._id
    unmountA()

    useCurrentUserMock.mockReturnValue({id: 'user-2'})
    const {client: clientB, transaction: transactionB} = mockClient(Promise.resolve(null))
    useClientMock.mockReturnValue(clientB)

    const {result: resultB} = renderHook(() => useSnoozes())
    await waitFor(() => expect(clientB.fetch).toHaveBeenCalled())
    act(() =>
      resultB.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )
    await waitFor(() => expect(transactionB.commit).toHaveBeenCalledTimes(1))
    const idB = (transactionB.createIfNotExists.mock.calls[0][0] as {_id: string})._id

    expect(idA).toBe('structureInbox.snoozes.user-1')
    expect(idB).toBe('structureInbox.snoozes.user-2')
    expect(idA).not.toBe(idB)
  })

  it('does not persist over a read it never actually saw', async () => {
    const fetch = deferred<string | null>()
    const {client, transaction} = mockClient(fetch.promise)
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useSnoozes())

    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )

    fetch.reject(new Error('network down'))
    // Let the hook's own `.catch()` run to completion — deterministically,
    // not by outrunning a real 10ms timer — before confirming `loadedRef`
    // never settled, so the persist effect never got to write.
    await fetch.promise.catch(() => undefined)
    await Promise.resolve()

    expect(transaction.commit).not.toHaveBeenCalled()
  })

  it('retries a failed write the next time the persist effect runs, instead of silently dropping it', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    transaction.commit = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue(undefined)
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result, rerender} = renderHook(() => useSnoozes())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() =>
      result.current.snooze('tasks', 'task-1', new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    )

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(console.error).toHaveBeenCalled())

    // Nothing about the snoozed state changes here — only `client`'s identity
    // does, standing in for any future unrelated reason the persist effect
    // might re-run. The load effect's own re-fetch is made to hang forever so
    // it cannot itself cause a second state change and confound what's being
    // tested: whether the *previously failed* write is retried. If the
    // failed commit had wrongly cleared `dirtyRef`, this second run would
    // skip the write entirely instead of retrying it.
    useClientMock.mockReturnValue({
      fetch: vi.fn().mockReturnValue(new Promise(() => {})),
      transaction: client.transaction,
    })
    rerender()

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(2))
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
