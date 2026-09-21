import {type SanityClient} from '@sanity/client'
import {Observable, Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {liveQuery$} from './liveQuery'

function fakeClient(events: Subject<unknown>) {
  return {listen: vi.fn(() => events)} as unknown as SanityClient
}

/** A cold observable that re-runs `produce` on every subscription, like `client.observable.fetch` does. */
function coldFetch(produce: () => string) {
  return new Observable<string>((subscriber) => {
    subscriber.next(produce())
    subscriber.complete()
  })
}

/**
 * A cold observable that re-runs `produce` on every subscription and either
 * emits its result or errors, like `coldFetch` above but for the recovery
 * tests below, which need some subscriptions to fail and others to succeed.
 */
function coldFetchMaybeFailing(produce: () => string | Error) {
  return new Observable<string>((subscriber) => {
    const result = produce()
    if (result instanceof Error) {
      subscriber.error(result)
    } else {
      subscriber.next(result)
      subscriber.complete()
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('liveQuery$', () => {
  it('fetches once up front, with no listen event needed', async () => {
    const client = fakeClient(new Subject())
    const values: string[] = []

    liveQuery$(
      client,
      'QUERY',
      {},
      coldFetch(() => 'rows'),
    ).subscribe((v) => values.push(v))
    await vi.advanceTimersByTimeAsync(500)

    expect(values).toEqual(['rows'])
  })

  it('refetches once a matching document changes', async () => {
    const events = new Subject<unknown>()
    const client = fakeClient(events)
    let call = 0
    const values: string[] = []

    liveQuery$(
      client,
      'QUERY',
      {},
      coldFetch(() => `rows-${++call}`),
    ).subscribe((v) => values.push(v))

    await vi.advanceTimersByTimeAsync(500)
    expect(values).toEqual(['rows-1'])

    events.next({type: 'mutation'})
    await vi.advanceTimersByTimeAsync(500)

    expect(values).toEqual(['rows-1', 'rows-2'])
  })

  it('coalesces a burst of events into a single refetch', async () => {
    const events = new Subject<unknown>()
    const client = fakeClient(events)
    let calls = 0
    const values: string[] = []

    liveQuery$(
      client,
      'QUERY',
      {},
      coldFetch(() => `rows-${++calls}`),
    ).subscribe((v) => values.push(v))

    await vi.advanceTimersByTimeAsync(500) // the initial, unconditional fetch
    expect(values).toEqual(['rows-1'])

    events.next({type: 'mutation'})
    events.next({type: 'mutation'})
    events.next({type: 'mutation'})
    await vi.advanceTimersByTimeAsync(500)

    // One refetch for the whole burst, not three.
    expect(values).toEqual(['rows-1', 'rows-2'])
  })

  it('passes listen the query and params it was given', () => {
    const client = fakeClient(new Subject())

    liveQuery$(
      client,
      'QUERY',
      {limit: 10},
      coldFetch(() => 'rows'),
    ).subscribe()

    expect(client.listen).toHaveBeenCalledWith('QUERY', {limit: 10}, expect.any(Object))
  })

  it('asks the listener to resume across a reconnect, not just watch for mutations', () => {
    const client = fakeClient(new Subject())

    liveQuery$(client, 'QUERY', {}, coldFetch(() => 'rows')).subscribe()

    expect(client.listen).toHaveBeenCalledWith(
      'QUERY',
      {},
      {enableResume: true, events: ['mutation', 'welcome', 'reset']},
    )
  })

  it('refetches on a bare reconnect signal (a missed mutation during a dropped connection), not just a mutation event', async () => {
    const events = new Subject<unknown>()
    const client = fakeClient(events)
    let call = 0
    const values: string[] = []

    liveQuery$(
      client,
      'QUERY',
      {},
      coldFetch(() => `rows-${++call}`),
    ).subscribe((v) => values.push(v))

    await vi.advanceTimersByTimeAsync(500)
    expect(values).toEqual(['rows-1'])

    events.next({type: 'reset'})
    await vi.advanceTimersByTimeAsync(500)

    expect(values).toEqual(['rows-1', 'rows-2'])
  })

  describe('recovering from a failed refetch', () => {
    it('recovers on the next refetch after one fails, instead of staying dead for the rest of the session', async () => {
      const events = new Subject<unknown>()
      const client = fakeClient(events)
      let call = 0
      const values: string[] = []

      liveQuery$(
        client,
        'QUERY',
        {},
        coldFetchMaybeFailing(() => {
          call += 1
          return call === 1 ? new Error('transient 503') : `rows-${call}`
        }),
        (error) => `error: ${error.message}`,
      ).subscribe((v) => values.push(v))

      // First fetch (the initial, unconditional one) fails.
      await vi.advanceTimersByTimeAsync(500)
      expect(values).toEqual(['error: transient 503'])

      // A second `listen` event triggers a second refetch, which succeeds.
      // Before this plan, the first failure would have terminated the whole
      // observable and this value would never arrive.
      events.next({type: 'mutation'})
      await vi.advanceTimersByTimeAsync(500)

      expect(values).toEqual(['error: transient 503', 'rows-2'])
    })

    it('does not complete the stream when a refetch fails', async () => {
      const events = new Subject<unknown>()
      const client = fakeClient(events)
      const completeSpy = vi.fn()

      liveQuery$(
        client,
        'QUERY',
        {},
        coldFetchMaybeFailing(() => new Error('boom')),
        () => 'recovered',
      ).subscribe({complete: completeSpy})

      await vi.advanceTimersByTimeAsync(500)

      expect(completeSpy).not.toHaveBeenCalled()
    })

    it('recovers more than once — fail, succeed, fail, succeed', async () => {
      const events = new Subject<unknown>()
      const client = fakeClient(events)
      let call = 0
      const values: string[] = []

      // Odd calls fail, even calls succeed — this is the shape that catches
      // a missing `defer`: without it, the underlying observable is only
      // ever subscribed to (and its error replayed) once, so a *second*
      // recovery after a *second* failure would not actually re-run the
      // fetch.
      liveQuery$(
        client,
        'QUERY',
        {},
        coldFetchMaybeFailing(() => {
          call += 1
          return call % 2 === 1 ? new Error(`fail-${call}`) : `rows-${call}`
        }),
        (error) => error.message,
      ).subscribe((v) => values.push(v))

      await vi.advanceTimersByTimeAsync(500) // call 1: fails
      expect(values).toEqual(['fail-1'])

      events.next({type: 'mutation'})
      await vi.advanceTimersByTimeAsync(500) // call 2: succeeds
      expect(values).toEqual(['fail-1', 'rows-2'])

      events.next({type: 'mutation'})
      await vi.advanceTimersByTimeAsync(500) // call 3: fails again
      expect(values).toEqual(['fail-1', 'rows-2', 'fail-3'])

      events.next({type: 'mutation'})
      await vi.advanceTimersByTimeAsync(500) // call 4: succeeds again
      expect(values).toEqual(['fail-1', 'rows-2', 'fail-3', 'rows-4'])
    })

    it('propagates a failed fetch when no onFetchError is supplied, preserving existing behaviour for an unmigrated caller', async () => {
      const events = new Subject<unknown>()
      const client = fakeClient(events)
      const values: string[] = []
      const errors: unknown[] = []

      liveQuery$(client, 'QUERY', {}, coldFetchMaybeFailing(() => new Error('boom'))).subscribe({
        next: (v) => values.push(v),
        error: (e) => errors.push(e),
      })

      await vi.advanceTimersByTimeAsync(500)

      expect(values).toEqual([])
      expect(errors).toHaveLength(1)
      expect((errors[0] as Error).message).toBe('boom')
    })

    it('still propagates a listen-channel error to the outer pipe, even with onFetchError supplied', async () => {
      const events = new Subject<unknown>()
      const client = fakeClient(events)
      const values: string[] = []
      const errors: unknown[] = []

      liveQuery$(
        client,
        'QUERY',
        {},
        coldFetch(() => 'rows'),
        () => 'recovered-from-fetch-error',
      ).subscribe({
        next: (v) => values.push(v),
        error: (e) => errors.push(e),
      })

      await vi.advanceTimersByTimeAsync(500)
      expect(values).toEqual(['rows'])

      // The `listen` channel itself errors — not a fetch failure. This is
      // not what `onFetchError` guards against, so it must still reach the
      // consumer's own outer `catchError`.
      events.error(new Error('listen channel died'))

      expect(errors).toHaveLength(1)
      expect((errors[0] as Error).message).toBe('listen channel died')
    })
  })
})
