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
})
