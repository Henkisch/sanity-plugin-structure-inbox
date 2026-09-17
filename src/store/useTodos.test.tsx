import {ClientError} from '@sanity/client'
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

  it('retries a failed write the next time the persist effect runs, instead of silently dropping it', async () => {
    const {client, transaction} = mockClient(Promise.resolve(null))
    transaction.commit = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue(undefined)
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result, rerender} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    await waitFor(() => expect(transaction.commit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(console.error).toHaveBeenCalled())

    // Nothing about the todos state changes here — only `client`'s identity
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

/**
 * A minimal, stateful stand-in for the *recipient's* real document —
 * tracks its own revision and rejects a write against a stale one, the
 * same way Sanity's real API does. Used to prove `transferTo` survives
 * two overlapping transfers to the same recipient without silently
 * dropping one of them.
 */
function fakeRecipientDocument() {
  let doc: {rev: string; items: string} | null = null
  let revCounter = 0

  function conflict(): ClientError {
    return new ClientError({statusCode: 409, body: {}, url: 'test://conflict', method: 'PATCH', headers: {}})
  }

  return {
    getItems: (): unknown[] => (doc ? (JSON.parse(doc.items) as {items: unknown[]}).items : []),
    fetch: async () => (doc ? {_rev: doc.rev, value: doc.items} : null),
    create: async (items: string) => {
      if (doc) throw conflict()
      revCounter += 1
      doc = {rev: `rev-${revCounter}`, items}
    },
    patchIfRevisionMatches: async (expectedRev: string, items: string) => {
      if (!doc || doc.rev !== expectedRev) throw conflict()
      revCounter += 1
      doc = {rev: `rev-${revCounter}`, items}
    },
  }
}

describe('useTodos transferTo', () => {
  afterEach(() => {
    cleanup()
    useClientMock.mockReset()
  })

  it('does not silently lose a todo when two transfers land on the same recipient close together', async () => {
    const recipientDocId = 'structureInbox.todos.recipient-1'
    const myDocId = 'structureInbox.todos.user-1'
    const recipient = fakeRecipientDocument()

    const fetch = vi.fn(async (_query: string, params: {id: string}) => {
      if (params.id === recipientDocId) return recipient.fetch()
      if (params.id === myDocId) return null // this editor's own, empty initial load
      return null
    })

    function patchBuilder(id: string) {
      let expectedRev: string | undefined
      let pendingItems: string | undefined
      const builder = {
        ifRevisionId: (rev: string) => {
          expectedRev = rev
          return builder
        },
        set: (fields: {items: string}) => {
          pendingItems = fields.items
          return builder
        },
        commit: vi.fn(async () => {
          if (id !== recipientDocId || expectedRev === undefined || pendingItems === undefined) {
            throw new Error('test stub: unexpected patch call shape')
          }
          await recipient.patchIfRevisionMatches(expectedRev, pendingItems)
        }),
      }
      return builder
    }

    const create = vi.fn(async (input: {_id: string; items: string}) => {
      if (input._id !== recipientDocId) throw new Error('test stub: unexpected create target')
      await recipient.create(input.items)
    })
    const patch = vi.fn(patchBuilder)

    const client = {
      fetch,
      transaction: vi.fn(() => fakeTransaction()), // this editor's own persist effect, unrelated to transferTo
      patch,
      create,
    }
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Task A'}))
    act(() => result.current.add({title: 'Task B'}))
    const [idA, idB] = result.current.state.items.map((item) => item.id)

    // The race this regresses: both transfers read the recipient's
    // (currently empty) document before either has written anything back,
    // the same way two editors handing off to the same third person, or
    // one editor transferring two todos back-to-back, would.
    await act(async () => {
      await Promise.all([
        result.current.transferTo(idA, 'recipient-1'),
        result.current.transferTo(idB, 'recipient-1'),
      ])
    })

    expect(recipient.getItems()).toHaveLength(2)
    // Proves the retry path actually ran, not that the two calls happened
    // to land sequentially by accident: one of the two writes to the
    // recipient's document must have hit a real conflict and retried.
    expect(create.mock.calls.length + patch.mock.calls.length).toBeGreaterThan(2)
  })
})
