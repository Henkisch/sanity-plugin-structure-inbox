import {type SanityClient} from '@sanity/client'
import {act, cleanup, renderHook} from '@testing-library/react'
import {Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useDocumentCounts} from './needsAttention'

/**
 * `client.observable`/`client.fetch` aren't used here — `useDocumentCounts`
 * calls the plain promise-returning `client.fetch`, wrapped in `from(...)`
 * — so the fetch stub returns a real `Promise`, not a cold `Observable`
 * (contrast with `assignmentStore.test.ts`'s own stub, which needs a cold
 * observable because the production code there calls
 * `client.observable.fetch`).
 */
function stubClient(fetchImpl: () => Promise<{name: string; count: number}[]>) {
  const listenEvents = new Subject<{type: string}>()
  const fetch = vi.fn(fetchImpl)
  const client = {
    fetch,
    listen: vi.fn(() => listenEvents),
  } as unknown as SanityClient
  return {client, fetch}
}

describe('useDocumentCounts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('resolves the real counts on a successful fetch', async () => {
    const {client} = stubClient(async () => [{name: 'release-1', count: 3}])

    const {result} = renderHook(() => useDocumentCounts(client, ['release-1']))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.get('release-1')).toBe(3)
  })

  it('degrades to an empty map instead of throwing during render when the fetch rejects', async () => {
    // The actual bug this regresses: with no `catchError`, a rejected fetch
    // became an unhandled observable error — `from(promise)` turns a
    // rejected promise into exactly that — which `useObservable` re-throws
    // during render, crashing the whole "Needs attention" card (every
    // off-track release row, not just the document-count field) instead
    // of just this one field quietly staying unknown.
    const {client} = stubClient(() => Promise.reject(new Error('network down')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useDocumentCounts(client, ['release-1']))
    }).not.toThrow()

    const {result} = renderHook(() => useDocumentCounts(client, ['release-1']))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current.size).toBe(0)
  })

  it('returns an empty map immediately when there are no active releases, without fetching', () => {
    const {client, fetch} = stubClient(async () => [])

    const {result} = renderHook(() => useDocumentCounts(client, []))

    expect(result.current.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
