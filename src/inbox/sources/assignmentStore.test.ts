import {type SanityClient} from '@sanity/client'
import {act, cleanup, renderHook} from '@testing-library/react'
import {Observable, Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {assignmentDocId, useAssignmentStore} from './assignmentStore'

// Sanity document ids: start with an alphanumeric, only alphanumeric/`._-`
// after that, capped at 128 characters total.
const VALID_DOC_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

describe('assignmentDocId', () => {
  it('stays a valid, short document id even for a target that embeds a real URL', () => {
    // The exact shape that broke live: a link-checker finding's key embeds
    // the field path and the full broken URL. Sanitizing that in place (the
    // original implementation) blew past Sanity's 128-character document id
    // limit and failed with "is not a valid document ID" — silently, for
    // this one finding kind only (a reference finding's short key stayed
    // under the limit, which is why this went unnoticed at first).
    const longTargetId =
      'link-ceb03ad4-15f0-425b-a90d-2c9e258272bb-body-' +
      'https://api.github.com/repos/anthropics/definitely-nonexistent-repo-xyz123-demo'

    const id = assignmentDocId('structureInbox.linkCheckerAssignment', longTargetId)

    expect(id.length).toBeLessThanOrEqual(128)
    expect(id).toMatch(VALID_DOC_ID)
  })

  it('is deterministic — the same target always maps to the same id', () => {
    const a = assignmentDocId('structureInbox.draftAssignment', 'some-draft-id')
    const b = assignmentDocId('structureInbox.draftAssignment', 'some-draft-id')
    expect(a).toBe(b)
  })

  it('gives different targets different ids', () => {
    const a = assignmentDocId('structureInbox.draftAssignment', 'draft-one')
    const b = assignmentDocId('structureInbox.draftAssignment', 'draft-two')
    expect(a).not.toBe(b)
  })

  it('keeps a short, ordinary target id valid too', () => {
    const id = assignmentDocId('structureInbox.draftAssignment', 'a1b2c3')
    expect(id).toMatch(VALID_DOC_ID)
  })
})

interface AssignmentRow {
  targetId: string
  assignedTo: string
}

/**
 * `client.observable.fetch(query)` is called exactly once by the production
 * code (memoized inside `byTarget$`), so a plain `of(rows)` would snapshot
 * `rows` at that one call and never see a later `setRows` — the observable
 * itself must be cold, re-reading `rows` fresh on every *subscription*
 * (each `switchMap` resubscription inside `liveQuery$`), same as
 * `liveQuery.test.ts`'s own `coldFetch` helper. `client.listen` returns a
 * controllable `Subject` so a test can simulate the realtime listener
 * firing. `transaction()`/`delete()` are separately overridable per test,
 * for the rollback-on-failure case.
 */
function stubClient(initialRows: AssignmentRow[], commitError?: Error) {
  let rows = initialRows
  const observableFetch = vi.fn(
    () =>
      new Observable<AssignmentRow[]>((subscriber) => {
        subscriber.next(rows)
        subscriber.complete()
      }),
  )
  const listenEvents = new Subject<{type: string}>()
  const commit = commitError ? vi.fn().mockRejectedValue(commitError) : vi.fn().mockResolvedValue(undefined)
  const transaction = vi.fn(() => ({
    createIfNotExists: vi.fn().mockReturnThis(),
    patch: vi.fn().mockReturnThis(),
    commit,
  }))
  const del = vi.fn().mockResolvedValue(undefined)

  const client = {
    observable: {fetch: observableFetch},
    listen: vi.fn(() => listenEvents),
    transaction,
    delete: del,
  } as unknown as SanityClient

  return {
    client,
    commit,
    del,
    setRows: (next: AssignmentRow[]) => {
      rows = next
    },
    emitRemoteChange: () => listenEvents.next({type: 'mutation'}),
  }
}

describe('useAssignmentStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("reflects the acting editor's own assign immediately, without waiting for the live query to catch up", async () => {
    const {client, commit} = stubClient([])
    const {result} = renderHook(() => useAssignmentStore(client, 'structureInbox.assignment'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500) // the initial, unconditional fetch
    })
    expect(result.current.byTarget.size).toBe(0)

    let assignPromise: Promise<void> | undefined
    act(() => {
      assignPromise = result.current.assign('draft-1', 'user-1')
    })

    // The real bug this regresses: before this fix, nothing here updated
    // until `client.listen`'s own realtime event fired and the debounced
    // refetch completed — which sometimes silently never happened promptly,
    // and the row stayed stale until an unrelated full reload remounted the
    // hook. Assert immediately, with no timer advanced at all.
    expect(result.current.byTarget.get('draft-1')).toBe('user-1')

    await act(async () => {
      await assignPromise
    })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("reflects the acting editor's own unassign immediately", async () => {
    const {client, del} = stubClient([{targetId: 'draft-1', assignedTo: 'user-1'}])
    const {result} = renderHook(() => useAssignmentStore(client, 'structureInbox.assignment'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.byTarget.get('draft-1')).toBe('user-1')

    let unassignPromise: Promise<void> | undefined
    act(() => {
      unassignPromise = result.current.unassign('draft-1')
    })

    expect(result.current.byTarget.has('draft-1')).toBe(false)

    await act(async () => {
      await unassignPromise
    })
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('rolls back to the remote value if the write itself rejects', async () => {
    const {client} = stubClient([], new Error('network down'))

    const {result} = renderHook(() => useAssignmentStore(client, 'structureInbox.assignment'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.byTarget.size).toBe(0)

    let assignPromise: Promise<void> | undefined
    act(() => {
      assignPromise = result.current.assign('draft-1', 'user-1').catch(() => undefined)
    })
    expect(result.current.byTarget.get('draft-1')).toBe('user-1')

    await act(async () => {
      await assignPromise
    })
    expect(result.current.byTarget.has('draft-1')).toBe(false)
  })

  it("stops overriding once the live query confirms the write, so a later remote change (someone else reassigning it) becomes visible", async () => {
    const {client, setRows, emitRemoteChange} = stubClient([])
    const {result} = renderHook(() => useAssignmentStore(client, 'structureInbox.assignment'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    act(() => {
      void result.current.assign('draft-1', 'user-1')
    })
    expect(result.current.byTarget.get('draft-1')).toBe('user-1')

    // The live query catches up and agrees — the local override should
    // become inert rather than permanently masking this key.
    setRows([{targetId: 'draft-1', assignedTo: 'user-1'}])
    await act(async () => {
      emitRemoteChange()
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.byTarget.get('draft-1')).toBe('user-1')

    // Someone else reassigns it, entirely outside this editor's own
    // actions — this must now be visible, proving the earlier override
    // isn't stuck overriding this key forever.
    setRows([{targetId: 'draft-1', assignedTo: 'user-2'}])
    await act(async () => {
      emitRemoteChange()
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(result.current.byTarget.get('draft-1')).toBe('user-2')
  })
})
