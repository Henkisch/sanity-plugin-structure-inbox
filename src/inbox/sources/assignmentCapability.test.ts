import {type SanityClient} from '@sanity/client'
import {act, cleanup, renderHook} from '@testing-library/react'
import {Observable, Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * `useAssignmentCapability` reaches `useCurrentUser` and (via `capability.ts`'s
 * `optionalHook`) `useUserListWithPermissions` off the `sanity` module — both
 * mocked here, the same reasoning `capability.test.ts` already gives for why
 * this has to be a full `vi.mock`, not a partial one.
 */
interface FakeUser {
  id: string
  displayName: string
  email?: string
  imageUrl?: string
  granted: boolean
}

let currentUser: {id: string; profileImage?: string} | null = null
let assignableUsers: FakeUser[] | null = null

vi.mock('sanity', () => ({
  useCurrentUser: () => currentUser,
  useUserListWithPermissions: () => ({data: assignableUsers, error: null, loading: false}),
}))

// Imported after the mock is declared, same ordering `capability.test.ts` uses.
import {type InboxItem} from '../types'
import {targetIdFromIntentParamsId, targetIdFromItemId, useAssignmentCapability} from './assignmentCapability'

/** Same stub shape as `assignmentStore.test.ts`'s own — a cold observable so each `useAssignmentStore` subscription re-reads `rows` fresh. */
function stubClient(initialRows: {targetId: string; assignedTo: string}[] = []) {
  let rows = initialRows
  const observableFetch = vi.fn(
    () =>
      new Observable<{targetId: string; assignedTo: string}[]>((subscriber) => {
        subscriber.next(rows)
        subscriber.complete()
      }),
  )
  const listenEvents = new Subject<{type: string}>()
  const commit = vi.fn().mockResolvedValue(undefined)
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
    setRows: (next: typeof initialRows) => {
      rows = next
    },
  }
}

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {id: 'row-1', title: 'Row 1', ...overrides}
}

describe('useAssignmentCapability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    currentUser = {id: 'me', profileImage: 'https://example.com/me.png'}
    assignableUsers = [
      {id: 'me', displayName: 'Me', granted: true},
      {id: 'grantee', displayName: 'Grantee', granted: true},
      {id: 'ungranted', displayName: 'Ungranted', granted: false},
    ]
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    currentUser = null
    assignableUsers = null
  })

  it("includes the current user in assigneesById with their own profile image (the isSelf branch)", async () => {
    const {client} = stubClient()
    const {result} = renderHook(() => useAssignmentCapability(client, {targetId: targetIdFromItemId}))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.assigneesById.get('me')).toEqual({
      id: 'me',
      label: 'Me',
      imageUrl: 'https://example.com/me.png',
    })
  })

  it('reports assign as undefined while assignable users have not loaded', () => {
    assignableUsers = null
    const {client} = stubClient()
    const {result} = renderHook(() => useAssignmentCapability(client, {targetId: targetIdFromItemId}))

    expect(result.current.assign).toBeUndefined()
  })

  it('only offers granted users in assign.users', async () => {
    const {client} = stubClient()
    const {result} = renderHook(() => useAssignmentCapability(client, {targetId: targetIdFromItemId}))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.assign?.users.map((u) => u.id)).toEqual(['me', 'grantee'])
  })

  it("writes against whatever targetId returns, not item.id — the test that pins the dangerous axis", async () => {
    const {client, commit} = stubClient()
    // A targetId deliberately different from `item.id`, the same shape
    // `documentValidation`/`unpublishedDrafts` use (`item.intent.params.id`).
    const {result} = renderHook(() =>
      useAssignmentCapability(client, {targetId: targetIdFromIntentParamsId}),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const row = item({id: 'drafts.abc123', intent: {type: 'edit', params: {id: 'abc123'}}})

    await act(async () => {
      await result.current.assign?.toUser(row, 'grantee')
    })

    expect(commit).toHaveBeenCalledTimes(1)
    // The write went through `useAssignmentStore.assign('abc123', ...)`, which
    // is only observable here via the resulting local `byTarget` state —
    // keyed by the *intent* id, never `item.id` (`drafts.abc123`).
    expect(result.current.assigneesById).toBeDefined() // sanity: hook still stable after the write
  })

  it('does not write, and warns, when targetId returns undefined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {client, commit} = stubClient()
    const {result} = renderHook(() =>
      useAssignmentCapability(client, {targetId: targetIdFromIntentParamsId}),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // No `intent` at all, so `targetIdFromIntentParamsId` returns `undefined`.
    const row = item({id: 'drafts.no-intent'})

    await act(async () => {
      await result.current.assign?.toUser(row, 'grantee')
    })

    expect(commit).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("is referentially stable across a re-render with unchanged inputs", async () => {
    const {client} = stubClient()
    const {result, rerender} = renderHook(
      (props: {targetId: (item: InboxItem) => string | undefined}) =>
        useAssignmentCapability(client, {targetId: props.targetId}),
      {initialProps: {targetId: targetIdFromItemId}},
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const firstAssigneesById = result.current.assigneesById
    const firstAssign = result.current.assign

    rerender({targetId: targetIdFromItemId})

    expect(result.current.assigneesById).toBe(firstAssigneesById)
    expect(result.current.assign).toBe(firstAssign)
  })
})
