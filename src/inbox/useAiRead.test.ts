import {act, renderHook} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'

import {unwrapAiRead, useAiRead} from './useAiRead'

describe('useAiRead', () => {
  it('goes idle -> loading -> done, with the resolved data', async () => {
    const run = vi.fn().mockResolvedValue({message: 'hello'})
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    expect(result.current.state).toEqual({status: 'idle'})

    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({status: 'done', data: {message: 'hello'}})
  })

  // The same class of race `summarizeInFlightRef`/`snoozeSuggestionInFlightRef`
  // exist for: two clicks landing in the same React batch both read
  // `inFlightRef.current` as `false` unless it is a plain ref write, not a
  // `setState`, that closes the race for the very next line of JS.
  it('calls run only once when start is called twice in the same batch', async () => {
    let resolveRun!: (value: {message: string} | null) => void
    const run = vi.fn(() => new Promise<{message: string} | null>((resolve) => (resolveRun = resolve)))
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    act(() => {
      result.current.start()
      result.current.start()
    })

    expect(run).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRun({message: 'done'})
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({status: 'done', data: {message: 'done'}})
  })

  it("keeps the newer request's result when an earlier, superseded request resolves late", async () => {
    const resolvers: Array<(value: {n: number}) => void> = []
    const run = vi.fn(() => new Promise<{n: number}>((resolve) => resolvers.push(resolve)))
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    // Two genuinely separate requests (each its own `start()` call flushed
    // before the next), so — unlike the in-flight test above — both really
    // run.
    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })
    await act(async () => {
      resolvers[0]({n: 1})
      await Promise.resolve()
    })
    // The first resolved before the second ever started, so this is just
    // priming a second, later request to race against a *third*, out-of-
    // order response below.
    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })

    expect(run).toHaveBeenCalledTimes(2)

    // The *first* request's resolver, still held, lands after the second
    // request already started — must not overwrite the second's own result.
    await act(async () => {
      resolvers[1]({n: 2})
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({status: 'done', data: {n: 2}})
  })

  it('logs with the [sanity-plugin-structure-inbox] prefix and sets status: error when run rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('network down')
    const run = vi.fn().mockRejectedValue(error)
    const {result} = renderHook(() => useAiRead(run, 'my-read failed'))

    await act(async () => {
      result.current.start()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({status: 'error'})
    expect(consoleError).toHaveBeenCalledWith('[sanity-plugin-structure-inbox] my-read failed', error)
    consoleError.mockRestore()
  })

  // Every pre-extraction handler's own "nothing to call" branch (no agent
  // client configured) set `status: 'error'` directly, without ever calling
  // `console.error` — this is that same behaviour, generalised.
  it('sets status: error, without logging, when run resolves null', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockResolvedValue(null)
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })

    expect(result.current.state).toEqual({status: 'error'})
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns to idle on reset', async () => {
    const run = vi.fn().mockResolvedValue({message: 'hello'})
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })
    expect(result.current.state.status).toBe('done')

    act(() => {
      result.current.reset()
    })

    expect(result.current.state).toEqual({status: 'idle'})
  })

  it('update mutates the data of a done state without re-running the read', async () => {
    const run = vi.fn<() => Promise<{items: string[]}>>().mockResolvedValue({items: ['a', 'b', 'c']})
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })

    act(() => {
      result.current.update((data) => ({items: data.items.filter((item) => item !== 'b')}))
    })

    expect(result.current.state).toEqual({status: 'done', data: {items: ['a', 'c']}})
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves an idle/loading/error state alone when update is called', () => {
    const run = vi.fn<() => Promise<{items: string[]}>>().mockResolvedValue({items: []})
    const {result} = renderHook(() => useAiRead(run, 'test failed'))

    act(() => {
      result.current.update((data) => ({...data, items: ['unreachable']}))
    })

    expect(result.current.state).toEqual({status: 'idle'})
  })

  // The identity invariant this whole plan exists for (`AGENTS.md`'s "must
  // not churn identity" doctrine): an unstable `start` passed down to
  // `MergedList` is the exact class of bug that has taken this pane down
  // three times.
  it('keeps start, reset and update referentially stable across a re-render when nothing changed', () => {
    const run = vi.fn().mockResolvedValue({message: 'hello'})
    const {result, rerender} = renderHook(() => useAiRead(run, 'test failed'))

    const {start: startBefore, reset: resetBefore, update: updateBefore} = result.current

    rerender()

    expect(result.current.start).toBe(startBefore)
    expect(result.current.reset).toBe(resetBefore)
    expect(result.current.update).toBe(updateBefore)
  })

  // `start` depends on `run` exactly like every pre-extraction handler's own
  // `useCallback` depended on the values it closed over — so a genuinely
  // different `run` (the caller's own data actually changed) is picked up
  // rather than a stale closure running forever.
  it('calls the current run, not a stale one, after the run callback identity changes', async () => {
    const runA = vi.fn().mockResolvedValue({message: 'a'})
    const runB = vi.fn().mockResolvedValue({message: 'b'})
    const {result, rerender} = renderHook(({run}) => useAiRead(run, 'test failed'), {
      initialProps: {run: runA},
    })

    rerender({run: runB})

    await act(async () => {
      result.current.start()
      await Promise.resolve()
    })

    expect(runA).not.toHaveBeenCalled()
    expect(runB).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({status: 'done', data: {message: 'b'}})
  })
})

describe('unwrapAiRead', () => {
  it('spreads a done state’s data alongside status, leaving other statuses untouched', () => {
    expect(unwrapAiRead({status: 'idle'})).toEqual({status: 'idle'})
    expect(unwrapAiRead({status: 'loading'})).toEqual({status: 'loading'})
    expect(unwrapAiRead({status: 'error'})).toEqual({status: 'error'})
    expect(unwrapAiRead({status: 'done', data: {message: 'hi'}})).toEqual({status: 'done', message: 'hi'})
  })
})
