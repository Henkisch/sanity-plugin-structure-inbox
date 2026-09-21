/**
 * Plan 087: investigating whether `SourceFeed`'s fingerprint-gated report
 * effect (`src/inbox/SourceFeed.tsx:149-207`, the mechanism the comment at
 * `:106-132` explains and protects) can hand `MergedList` a capability that
 * closes over state staler than what actually exists.
 *
 * Three things are tested here, one per plan step:
 *  - Step 1: the abstract mechanism — any capability whose closure changes
 *    without moving a fingerprint is handed out stale. Confirmed.
 *  - Step 2: the concrete `todos` path — an edit that resubmits identical
 *    field values bumps `updatedAt` (`withUpdatedTodo`,
 *    `src/store/todos.ts:90-108`) without changing anything the `todos`
 *    source's item projection carries (`src/inbox/sources/todos.ts:107-129`
 *    has no `updatedAt` field), so `useStableItems` calls the items equal,
 *    no fingerprint moves, and the report does not re-fire. Confirmed
 *    reachable, but narrower than the plan's own wording ("returns silently
 *    when the id is not found") suggested: the stale `transferTo` closure
 *    still *finds* the item (its id is untouched), it just hands the
 *    recipient a snapshot missing the just-bumped `updatedAt`. A genuine
 *    removal or addition always changes the projected items' length, which
 *    does move the fingerprint — so "transfers the wrong id" and "silently
 *    no-ops" are not reachable this way; only "transfers a slightly stale
 *    snapshot" is.
 *  - Step 3: the lossy `users.length` fingerprint — swapping who is
 *    assignable without changing how many people are assignable leaves the
 *    report un-refired, so the picker keeps rendering the old membership and
 *    the old `toUser`.
 *
 * See `plans/087-investigate-the-stale-capability-snapshot.md` for the full
 * writeup and `## Findings`.
 */
import {ClientError} from '@sanity/client'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {useState} from 'react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Snoozes} from '../store/useSnoozes'
import {SourceFeed, type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxSource} from './types'

afterEach(cleanup)

const NOW = Date.now()

function fakeSnoozes(): Snoozes {
  return {state: EMPTY_SNOOZES, snooze: vi.fn(), wake: vi.fn()}
}

describe('Step 1: abstract reproduction — a capability closing over mutable state', () => {
  it('hands out a stale closure when the closed-over value changes without moving any fingerprint', () => {
    // Stands in for `useTodos`' `state`: a plain mutable box that a real
    // React state value has no equivalent of, changed directly rather than
    // through `setState` so that changing it never itself causes a
    // re-render — the point being to move the closed-over value *without*
    // moving any fingerprint.
    //
    // Critically, `useItems` below reads `mutable.value` into a local
    // `const` at *call time* and closes over that snapshot, not over
    // `mutable` itself — matching `useTodos.ts`'s real shape: `transferTo`'s
    // `useCallback(..., [client, state])` closes over whatever `state` value
    // existed at the render that produced it, a plain immutable snapshot,
    // not a live-read reference cell. Closing over `mutable` directly (i.e.
    // reading `mutable.value` from inside `toUser`'s own body, invoked
    // later) would always see the *current* value regardless of which
    // render's closure is called — which is not what a real stale closure
    // does, and was confirmed here to make an earlier draft of this test
    // pass for the wrong reason before this snapshot was added.
    const mutable = {value: 'first'}
    const seen: string[] = []

    // A single stable `InboxSource`, the same object across every render —
    // matching `source` being a raw (non-fingerprinted) dependency in
    // `SourceFeed.tsx`'s own report effect: recreating it every render would
    // force a re-report for an uninteresting reason.
    const source: InboxSource = {
      name: 'stale-transfer',
      title: 'Stale transfer',
      useItems: () => {
        const snapshot = mutable.value
        return {
          items: [],
          // Same shape as `todos.ts`'s own `transfer`: a fixed-length user
          // list plus a `toUser` that closes over this render's snapshot.
          transfer: {
            users: [{id: 'u1', label: 'User 1'}],
            toUser: async (_item: InboxItem, _userId: string) => {
              seen.push(snapshot)
            },
          },
        }
      },
    }

    const reports: Record<string, SourceReport> = {}
    const onReport = vi.fn((name: string, report: SourceReport) => {
      reports[name] = report
    })

    function Host() {
      const [, setTick] = useState(0)
      return (
        <>
          <SourceFeed now={NOW} onReport={onReport} snoozes={fakeSnoozes()} source={source} />
          <button onClick={() => setTick((t) => t + 1)} type="button">
            bump
          </button>
        </>
      )
    }

    render(<Host />)

    const firstReport = reports['stale-transfer']
    expect(firstReport).toBeDefined()
    expect(firstReport.transfer?.users).toHaveLength(1)

    // Change the closed-over value and force a re-render, without moving
    // `items`, `transfer.users.length`, or anything else `SourceFeed`
    // fingerprints.
    mutable.value = 'second'
    fireEvent.click(screen.getByText('bump'))

    const secondReport = reports['stale-transfer']
    // The report object itself never changed identity — proof the effect
    // did not re-fire.
    expect(secondReport).toBe(firstReport)

    void secondReport.transfer?.toUser({id: 'x', title: 'x'}, 'u1')
    expect(seen).toEqual(['first']) // stale: should have seen 'second'
  })

  // Plan 087's own Findings conclude "reachable, narrow": confirmed, but no
  // fix is agreed here (an investigation plan does not implement one — see
  // the plan's own STOP condition on touching `SourceFeed.tsx`'s dependency
  // list). Left skipped, asserting the *fixed* behaviour, so a future fix
  // has a target to turn green rather than only a document describing one.
  // Do not unskip this without also making the test above obsolete — they
  // assert opposite outcomes for the same scenario.
  it.skip('plan 087: a reported capability should read the latest closed-over state, not the snapshot from when it last reported', () => {
    const mutable = {value: 'first'}
    const seen: string[] = []

    const source: InboxSource = {
      name: 'stale-transfer',
      title: 'Stale transfer',
      useItems: () => {
        const snapshot = mutable.value
        return {
          items: [],
          transfer: {
            users: [{id: 'u1', label: 'User 1'}],
            toUser: async (_item: InboxItem, _userId: string) => {
              seen.push(snapshot)
            },
          },
        }
      },
    }

    const reports: Record<string, SourceReport> = {}
    const onReport = vi.fn((name: string, report: SourceReport) => {
      reports[name] = report
    })

    function Host() {
      const [, setTick] = useState(0)
      return (
        <>
          <SourceFeed now={NOW} onReport={onReport} snoozes={fakeSnoozes()} source={source} />
          <button onClick={() => setTick((t) => t + 1)} type="button">
            bump
          </button>
        </>
      )
    }

    render(<Host />)

    mutable.value = 'second'
    fireEvent.click(screen.getByText('bump'))

    void reports['stale-transfer'].transfer?.toUser({id: 'x', title: 'x'}, 'u1')
    expect(seen).toEqual(['second']) // the fix target: never stale
  })
})

describe('Step 3: the lossy users.length fingerprint', () => {
  it('does not re-report when assignable membership changes but the count stays the same', () => {
    // Plain mutable state outside React, not `useState`: a real source backed
    // by `useUserListWithPermissions` re-derives its user list from that
    // hook's own state on every render of *itself*, which `source.useItems()`
    // being called fresh each `SourceFeed` render already reproduces here —
    // it does not require `source`'s own identity to change, so `source`
    // stays a stable object the way a real one does (see `SourceFeed.tsx`'s
    // dependency list: `source` itself is a raw dependency, so changing its
    // identity would be a different, uninteresting way to force a re-report).
    const membership = {current: ['a', 'b']}
    const seenTransfers: string[][] = []

    const source: InboxSource = {
      name: 'stale-membership',
      title: 'Stale membership',
      // Snapshot at call time, same reasoning as Step 1's fixture above:
      // `toUser` must close over *this render's* membership value, not read
      // the live mutable box, or it would see the "current" list regardless
      // of whether this particular closure is the stale one.
      useItems: () => {
        const snapshot = membership.current
        return {
          items: [],
          assign: {
            users: snapshot.map((id) => ({id, label: `User ${id}`})),
            toUser: async (_item: InboxItem, userId: string) => {
              seenTransfers.push([...snapshot, `chose:${userId}`])
            },
          },
        }
      },
    }

    const reports: Record<string, SourceReport> = {}
    const onReport = vi.fn((name: string, report: SourceReport) => {
      reports[name] = report
    })

    function Host() {
      const [, setTick] = useState(0)
      return (
        <>
          <SourceFeed now={NOW} onReport={onReport} snoozes={fakeSnoozes()} source={source} />
          <button onClick={() => setTick((t) => t + 1)} type="button">
            bump
          </button>
        </>
      )
    }

    render(<Host />)

    const firstReport = reports['stale-membership']
    expect(firstReport?.assign?.users.map((u) => u.id)).toEqual(['a', 'b'])

    // Same count (2 -> 2), different actual people — the fingerprint
    // (`assignUserCount`) cannot tell this apart from no change at all.
    membership.current = ['c', 'd']
    fireEvent.click(screen.getByText('bump'))

    const secondReport = reports['stale-membership']
    // Same object: the report effect never re-ran.
    expect(secondReport).toBe(firstReport)
    expect(secondReport.assign?.users.map((u) => u.id)).toEqual(['a', 'b']) // stale: should be ['c', 'd']

    // And the stale picker's own `toUser` call carries the stale membership
    // through too — not just the label list, but who it believes is
    // assignable at all.
    void secondReport.assign?.toUser({id: 'row', title: 'row'}, 'c')
    expect(seenTransfers).toEqual([['a', 'b', 'chose:c']]) // stale: 'c' isn't even in this snapshot's own list
  })
})

// ---------------------------------------------------------------------------
// Step 2: the concrete `todos` path, against the real `useTodos`/`todos()`
// implementation with a mocked Sanity client — not the live test-studio (see
// this session's report for why: no `.env`/project configured there).
// ---------------------------------------------------------------------------

const {useClientMock} = vi.hoisted(() => ({useClientMock: vi.fn()}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useCurrentUser: () => ({id: 'user-1', name: 'User One'}),
  }
})

// Same reasoning as `unpublishedDrafts.test.ts`'s own mock of this module:
// `useUserListWithPermissions` needs a real Studio `source` context this test
// has no business standing up. Controlled membership instead.
vi.mock('./sources/capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sources/capability')>()),
  useAssignableUsers: () => ({
    data: [
      {id: 'user-2', displayName: 'User Two', granted: true},
      {id: 'user-3', displayName: 'User Three', granted: true},
    ],
  }),
}))

function conflictError(): ClientError {
  return new ClientError({statusCode: 409, body: {}, url: 'test://conflict', method: 'PATCH', headers: {}})
}

/** A tiny multi-document fake, keyed by document id, shared by both editors' todos documents. */
function fakeStore() {
  const docs = new Map<string, {rev: string; items: string}>()
  let revCounter = 0

  const fetch = vi.fn(async (query: string, params: {id: string}) => {
    const doc = docs.get(params.id)
    if (query.includes('_rev')) return doc ? {_rev: doc.rev, value: doc.items} : null
    return doc ? doc.items : null
  })

  const create = vi.fn(async (input: {_id: string; items: string}) => {
    if (docs.has(input._id)) throw conflictError()
    revCounter += 1
    docs.set(input._id, {rev: `rev-${revCounter}`, items: input.items})
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
        const doc = docs.get(id)
        if (!doc || doc.rev !== expectedRev || pendingItems === undefined) throw conflictError()
        revCounter += 1
        docs.set(id, {rev: `rev-${revCounter}`, items: pendingItems})
      }),
    }
    return builder
  }
  const patch = vi.fn((id: string) => patchBuilder(id))

  return {docs, client: {fetch, patch, create}}
}

afterEach(() => {
  useClientMock.mockReset()
})

describe('Step 2: the concrete todos path (mocked client, not live test-studio)', () => {
  it('a no-op edit (same title/description/dueBy, only updatedAt bumps) does not re-fire the report, and the stale transfer closure ships a snapshot missing the bump', async () => {
    const {docs, client} = fakeStore()
    useClientMock.mockReturnValue(client)

    // Imported after the mocks above are registered, matching the pattern
    // `unpublishedDrafts.test.ts` uses.
    const {todos} = await import('./sources/todos')

    const onReport = vi.fn()
    const reports: Record<string, SourceReport> = {}
    function Host() {
      return (
        <SourceFeed
          now={NOW}
          onReport={(name, report) => {
            onReport(name, report)
            reports[name] = report
          }}
          snoozes={fakeSnoozes()}
          source={todos()}
        />
      )
    }

    render(<Host />)
    await waitFor(() => expect(onReport).toHaveBeenCalled())

    const afterMount = reports.todos
    expect(afterMount.transfer?.users.map((u) => u.id)).toEqual(['user-2', 'user-3'])

    // Add a todo — a real content change, so the report is expected to
    // re-fire (item count 0 -> 1 moves `open`'s identity).
    await act(async () => {
      void afterMount.create?.({title: 'Task A'})
    })
    await waitFor(() => expect(reports.todos.open).toHaveLength(1))

    const afterAdd = reports.todos
    expect(afterAdd).not.toBe(afterMount) // confirms the report DID re-fire for a real change
    const idA = afterAdd.open[0].id
    const callsAfterAdd = onReport.mock.calls.length

    // The no-op edit: resubmits the exact same title, with no
    // description/dueBy, same as what's already there. Bumps `updatedAt`
    // (`withUpdatedTodo`) without changing anything the item projection
    // (`src/inbox/sources/todos.ts`) carries.
    await act(async () => {
      void afterAdd.update?.({id: idA} as InboxItem, {title: 'Task A'})
    })

    // The core Step 2 assertion: no new report. If this ever starts
    // failing, the staleness this plan investigated has been fixed (or
    // `todos.ts`'s item projection started carrying more than it does today)
    // — update this test's expectations, don't just relax the assertion.
    expect(onReport.mock.calls.length).toBe(callsAfterAdd)

    // Invoke the capability MergedList would actually be holding: the last
    // *reported* one, which — per the assertion above — is still `afterAdd`,
    // built before the no-op edit.
    const staleReport = reports.todos
    expect(staleReport).toBe(afterAdd)

    await act(async () => {
      await staleReport.transfer?.toUser({id: idA, title: 'Task A'}, 'user-2')
    })

    const recipientDoc = docs.get('structureInbox.todos.user-2')
    expect(recipientDoc).toBeDefined()
    const recipientItems = JSON.parse(recipientDoc!.items) as {
      items: {id: string; title: string; updatedAt?: string}[]
    }
    const transferred = recipientItems.items.find((item) => item.id === idA)

    // The item DOES arrive — `state.items.find` still finds it, because the
    // no-op edit never removed it or changed its id. This refutes the
    // plan's stronger worry ("silently no-ops because the id can't be
    // found"): that path is not reachable through `todos` alone, since any
    // add/remove changes the projected items' length and *does* move the
    // fingerprint.
    expect(transferred).toBeDefined()

    // What IS reachable: the transferred snapshot is stale. The real,
    // current state has `updatedAt` set on this item (the no-op edit bumped
    // it); the stale closure's `state` does not, because it was captured
    // before that edit.
    expect(transferred?.updatedAt).toBeUndefined()
  })
})
