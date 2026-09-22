import {ClientError} from '@sanity/client'
import {act, cleanup, renderHook, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {parseTodos} from './todos'
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

function conflictError(): ClientError {
  return new ClientError({statusCode: 409, body: {}, url: 'test://conflict', method: 'PATCH', headers: {}})
}

/**
 * A minimal, stateful stand-in for one todos document — tracks its own
 * revision and rejects a write against a stale one, the same way Sanity's
 * real API does. `write` lets a test simulate another tab landing a write
 * directly, bypassing this hook entirely, without going through the
 * revision guard itself.
 */
function fakeTodosDocument(seed?: {version: 1; items: unknown[]}) {
  let doc: {rev: string; items: string} | null = seed
    ? {rev: 'rev-seed', items: JSON.stringify(seed)}
    : null
  let revCounter = 0

  return {
    getItems: (): unknown[] => (doc ? (JSON.parse(doc.items) as {items: unknown[]}).items : []),
    revValue: (): {_rev: string; value: string} | null =>
      doc ? {_rev: doc.rev, value: doc.items} : null,
    write: (items: string) => {
      revCounter += 1
      doc = {rev: `rev-${revCounter}`, items}
    },
    create: async (items: string) => {
      if (doc) throw conflictError()
      revCounter += 1
      doc = {rev: `rev-${revCounter}`, items}
    },
    patchIfRevisionMatches: async (expectedRev: string, items: string) => {
      if (!doc || doc.rev !== expectedRev) throw conflictError()
      revCounter += 1
      doc = {rev: `rev-${revCounter}`, items}
    },
  }
}

/**
 * A client wired to one `fakeTodosDocument`, matching both query shapes
 * `useTodos.ts` actually sends: the load effect's plain field read, and
 * `writeTodosMerged`'s `{_rev, value}` read. `loadResult`, when given,
 * stands in for the load effect's own fetch instead of reading the current
 * document — used to control exactly when the initial load resolves.
 */
function clientForTodosDocument(
  doc: ReturnType<typeof fakeTodosDocument>,
  documentId: string,
  options: {loadResult?: Promise<string | null>} = {},
) {
  const ifRevisionCalls: string[] = []

  const fetch = vi.fn(async (query: string, params: {id: string}) => {
    if (params.id !== documentId) return null
    if (query.includes('_rev')) return doc.revValue()
    return options.loadResult ?? doc.revValue()?.value ?? null
  })

  function patchBuilder() {
    let expectedRev: string | undefined
    let pendingItems: string | undefined
    const builder = {
      ifRevisionId: (rev: string) => {
        expectedRev = rev
        ifRevisionCalls.push(rev)
        return builder
      },
      set: (fields: {items: string}) => {
        pendingItems = fields.items
        return builder
      },
      commit: vi.fn(async () => {
        if (expectedRev === undefined || pendingItems === undefined) {
          throw new Error('test stub: unexpected patch call shape')
        }
        await doc.patchIfRevisionMatches(expectedRev, pendingItems)
      }),
    }
    return builder
  }

  const patch = vi.fn(() => patchBuilder())
  const create = vi.fn(async (input: {_id: string; items: string}) => {
    if (input._id !== documentId) throw new Error('test stub: unexpected create target')
    await doc.create(input.items)
  })

  return {fetch, patch, create, ifRevisionCalls}
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

const DOCUMENT_ID = 'structureInbox.todos.user-1'

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
  // Restore the default editor identity for every other test in the file —
  // only the distinct-id test below ever changes it.
  useCurrentUserMock.mockReset()
  useCurrentUserMock.mockImplementation(() => ({id: 'user-1'}))
})

describe('useTodos', () => {
  it('keeps a todo added before the initial load resolves', async () => {
    const doc = fakeTodosDocument()
    const load = deferred<string | null>()
    const client = clientForTodosDocument(doc, DOCUMENT_ID, {loadResult: load.promise})
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())

    act(() => result.current.add({title: 'Write the launch email'}))
    expect(result.current.state.items.map((item) => item.title)).toEqual(['Write the launch email'])

    load.resolve(null)
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    expect(result.current.state.items.map((item) => item.title)).toEqual(['Write the launch email'])
  })

  it('persists a todo once the load has settled', async () => {
    const doc = fakeTodosDocument()
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    await waitFor(() => expect(doc.getItems()).toHaveLength(1))
    expect((doc.getItems()[0] as {title: string}).title).toBe('Write the launch email')

    // The real shape: a per-editor document id derived from the user id, and
    // the (unregistered) document type this hook writes. Hardcoded rather
    // than recomputed the way the implementation builds it, so a dropped
    // user suffix — every editor colliding on one shared document — would
    // actually fail this assertion instead of passing along with it. No
    // existing document yet, so this write goes through `create`, not `patch`.
    expect(client.create).toHaveBeenCalledTimes(1)
    const written = client.create.mock.calls[0][0] as unknown as {
      _id: string
      _type: string
      items: string
    }
    expect(written._id).toBe('structureInbox.todos.user-1')
    expect(written._type).toBe('structureInbox.todos')

    // The payload round-trips: what the hook sent to `create(...)` parses
    // back into exactly the state `add()` produced.
    expect(parseTodos(JSON.parse(written.items))).toEqual(result.current.state)
  })

  it('writes to a document id unique to this editor, never a shared one', async () => {
    useCurrentUserMock.mockReturnValue({id: 'user-1'})
    const docA = fakeTodosDocument()
    const clientA = clientForTodosDocument(docA, 'structureInbox.todos.user-1')
    useClientMock.mockReturnValue(clientA)

    const {result: resultA, unmount: unmountA} = renderHook(() => useTodos())
    await waitFor(() => expect(clientA.fetch).toHaveBeenCalled())
    act(() => resultA.current.add({title: 'Write the launch email'}))
    await waitFor(() => expect(docA.getItems()).toHaveLength(1))
    const idA = (clientA.create.mock.calls[0][0] as {_id: string})._id
    unmountA()

    useCurrentUserMock.mockReturnValue({id: 'user-2'})
    const docB = fakeTodosDocument()
    const clientB = clientForTodosDocument(docB, 'structureInbox.todos.user-2')
    useClientMock.mockReturnValue(clientB)

    const {result: resultB} = renderHook(() => useTodos())
    await waitFor(() => expect(clientB.fetch).toHaveBeenCalled())
    act(() => resultB.current.add({title: 'Write the launch email'}))
    await waitFor(() => expect(docB.getItems()).toHaveLength(1))
    const idB = (clientB.create.mock.calls[0][0] as {_id: string})._id

    expect(idA).toBe('structureInbox.todos.user-1')
    expect(idB).toBe('structureInbox.todos.user-2')
    expect(idA).not.toBe(idB)
  })

  it('does not persist over a read it never actually saw', async () => {
    const doc = fakeTodosDocument()
    const client = clientForTodosDocument(doc, DOCUMENT_ID, {
      loadResult: Promise.reject(new Error('network down')),
    })
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    // Let the hook's own `.catch()` run to completion — deterministically,
    // not by outrunning a real 10ms timer — before confirming `loadedRef`
    // never settled, so the persist effect never got to write.
    await client.fetch.mock.results[0].value.catch(() => undefined)
    await Promise.resolve()

    expect(client.patch).not.toHaveBeenCalled()
    expect(client.create).not.toHaveBeenCalled()
  })

  it('retries a failed write the next time the persist effect runs, instead of silently dropping it', async () => {
    const doc = fakeTodosDocument()
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
    client.create.mockImplementationOnce(async () => {
      throw new Error('network down')
    })
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result, rerender} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Write the launch email'}))

    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(console.error).toHaveBeenCalled())
    expect(doc.getItems()).toHaveLength(0) // the failed write never actually landed

    // Nothing about the todos state changes here — only `client`'s identity
    // does, standing in for any future unrelated reason the persist effect
    // might re-run. The load effect's own re-fetch is made to hang forever so
    // it cannot itself cause a second state change and confound what's being
    // tested: whether the *previously failed* write is retried. If the
    // failed write had wrongly cleared `dirtyRef`, this second run would
    // skip the write entirely instead of retrying it.
    useClientMock.mockReturnValue({
      ...client,
      fetch: vi.fn((query: string, params: {id: string}) => {
        if (query.includes('_rev') && params.id === DOCUMENT_ID) return Promise.resolve(doc.revValue())
        return new Promise(() => {})
      }),
    })
    rerender()

    await waitFor(() => expect(doc.getItems()).toHaveLength(1))
  })

  it('removes a todo for good', async () => {
    const doc = fakeTodosDocument()
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
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
 * Plan 062: the persist effect fetch-merges instead of blindly overwriting
 * the document, so a second tab's writes survive. These exercise that merge
 * path directly, against `fakeTodosDocument` rather than a call-count-only
 * stub — the point is what actually got written.
 */
describe('useTodos persist effect merge', () => {
  it('merges with what another tab already wrote, instead of overwriting it', async () => {
    const doc = fakeTodosDocument()
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    // Another tab's write lands directly on the document, bypassing this
    // hook entirely — the race this plan fixes.
    doc.write(
      JSON.stringify({
        version: 1,
        items: [{id: 'todo-b', title: 'Todo B', createdAt: '2024-01-01T00:00:00.000Z'}],
      }),
    )

    act(() => result.current.add({title: 'Todo A'}))

    await waitFor(() => expect(doc.getItems()).toHaveLength(2))
    const titles = doc.getItems().map((item) => (item as {title: string}).title).sort()
    expect(titles).toEqual(['Todo A', 'Todo B'])
  })

  it('guards the write with the revision its own fetch returned', async () => {
    const doc = fakeTodosDocument()
    doc.write(JSON.stringify({version: 1, items: []}))
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Todo A'}))

    await waitFor(() => expect(client.patch).toHaveBeenCalled())

    const revCallIndex = client.fetch.mock.calls.findIndex(([query]) => query.includes('_rev'))
    expect(revCallIndex).toBeGreaterThanOrEqual(0)
    const revResult = (await client.fetch.mock.results[revCallIndex].value) as {_rev: string} | null
    expect(revResult?._rev).toBeTruthy()
    expect(client.ifRevisionCalls).toContain(revResult?._rev)
  })

  it('retries once on a real write conflict, and the final write still contains both todos', async () => {
    const doc = fakeTodosDocument()
    doc.write(
      JSON.stringify({
        version: 1,
        items: [{id: 'todo-b', title: 'Todo B', createdAt: '2024-01-01T00:00:00.000Z'}],
      }),
    )
    const client = clientForTodosDocument(doc, DOCUMENT_ID)

    const realPatchIfRevisionMatches = doc.patchIfRevisionMatches.bind(doc)
    let patchAttempts = 0
    doc.patchIfRevisionMatches = async (rev: string, items: string) => {
      patchAttempts += 1
      if (patchAttempts === 1) throw conflictError()
      return realPatchIfRevisionMatches(rev, items)
    }

    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Todo A'}))

    await waitFor(() => expect(doc.getItems()).toHaveLength(2))
    expect(patchAttempts).toBeGreaterThanOrEqual(2)
    const titles = doc.getItems().map((item) => (item as {title: string}).title).sort()
    expect(titles).toEqual(['Todo A', 'Todo B'])
  })

  it('reports a real error and stays dirty for retry after every attempt conflicts', async () => {
    const fetch = vi.fn(async (query: string, params: {id: string}) => {
      if (params.id !== DOCUMENT_ID) return null
      return null // no existing document, either shape — forces the create branch
    })
    const create = vi.fn(async () => {
      throw conflictError()
    })
    const client = {fetch, patch: vi.fn(), create}
    useClientMock.mockReturnValue(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const {result} = renderHook(() => useTodos())
    await waitFor(() => expect(client.fetch).toHaveBeenCalled())

    act(() => result.current.add({title: 'Todo A'}))

    // MAX_ATTEMPTS in `writeTodosMerged` is 5 — every attempt here conflicts,
    // so all 5 run before the write finally rejects.
    await waitFor(() => expect(create).toHaveBeenCalledTimes(5))
    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        '[sanity-plugin-structure-inbox] could not save todos',
        expect.anything(),
      ),
    )

    // dirtyRef is still set: a later, unrelated reason for the effect to
    // run (standing in here for the user editing the same todo again) must
    // retry the write rather than silently treating it as done.
    create.mockClear()
    act(() =>
      result.current.update(result.current.state.items[0].id, {title: 'Todo A (edited)'}),
    )
    await waitFor(() => expect(create).toHaveBeenCalled())
  })

  it('a locally-removed todo comes back from the merge — known limitation, see plan 074', async () => {
    const doc = fakeTodosDocument()
    doc.write(
      JSON.stringify({
        version: 1,
        items: [{id: 'todo-b', title: 'Todo B', createdAt: '2024-01-01T00:00:00.000Z'}],
      }),
    )
    const client = clientForTodosDocument(doc, DOCUMENT_ID)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useTodos())
    // The load pulls todo B in from the seeded document.
    await waitFor(() => expect(result.current.state.items).toHaveLength(1))

    act(() => result.current.remove('todo-b'))
    expect(result.current.state.items).toEqual([]) // gone locally, right away

    // `mergeTodos` (src/store/todos.ts) is a pure union: it has no way to
    // represent "this id was deliberately removed", so the persist effect's
    // merge with the server's still-there copy brings it right back. This is
    // a known, accepted gap — plan 074 is the one that adds tombstones. This
    // test documents *current* behaviour; do not "fix" it by changing
    // `mergeTodos` here.
    await waitFor(() => expect(doc.getItems()).toHaveLength(1))
    expect((doc.getItems()[0] as {id: string}).id).toBe('todo-b')
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
    // The persist effect now shares the same fetch/patch/create path as
    // `transferTo` (plan 062 — both go through `writeTodosMerged`), so this
    // editor's own document needs a real, working target too, not just the
    // recipient's. It's otherwise uninteresting to this test.
    const own = fakeRecipientDocument()

    const fetch = vi.fn(async (_query: string, params: {id: string}) => {
      if (params.id === recipientDocId) return recipient.fetch()
      if (params.id === myDocId) return own.fetch()
      return null
    })

    function targetFor(id: string) {
      if (id === recipientDocId) return recipient
      if (id === myDocId) return own
      return null
    }

    function patchBuilder(id: string) {
      let expectedRev: string | undefined
      let pendingItems: string | undefined
      const target = targetFor(id)
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
          if (!target || expectedRev === undefined || pendingItems === undefined) {
            throw new Error('test stub: unexpected patch call shape')
          }
          await target.patchIfRevisionMatches(expectedRev, pendingItems)
        }),
      }
      return builder
    }

    const create = vi.fn(async (input: {_id: string; items: string}) => {
      const target = targetFor(input._id)
      if (!target) throw new Error('test stub: unexpected create target')
      await target.create(input.items)
    })
    const patch = vi.fn(patchBuilder)

    const client = {fetch, patch, create}
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
    // Filtered to the recipient specifically — `create`/`patch` are now
    // shared with this editor's own persist effect too, and calls against
    // `myDocId` aren't evidence of anything this test is about.
    const recipientCreateCalls = create.mock.calls.filter(([input]) => input._id === recipientDocId).length
    const recipientPatchCalls = patch.mock.calls.filter(([id]) => id === recipientDocId).length
    expect(recipientCreateCalls + recipientPatchCalls).toBeGreaterThan(2)
  })
})
