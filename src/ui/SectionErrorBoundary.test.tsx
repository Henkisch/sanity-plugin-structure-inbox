import {act, cleanup, render, screen} from '@testing-library/react'
import {type ReactNode} from 'react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {SectionErrorBoundary} from './SectionErrorBoundary'

// `vitest.config.ts` sets `globals: false`, so `@testing-library/react`'s
// framework-detected auto-cleanup never registers — without this, one test's
// DOM stays mounted for the next.
afterEach(cleanup)

function AlwaysThrows(): null {
  throw new Error('always throws')
}

describe('SectionErrorBoundary', () => {
  it('recovers once retry is called after a transient throw (the regression)', () => {
    // The boundary logs the caught error via console.error; expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    let shouldThrow = true
    function MaybeThrows(): ReactNode {
      if (shouldThrow) throw new Error('transient')
      return <div>recovered</div>
    }

    let retry: (() => void) | undefined
    render(
      <SectionErrorBoundary
        fallback={(error, r) => {
          retry = r
          return <div>fallback: {error.message}</div>
        }}
        onCatch={() => {}}
      >
        <MaybeThrows />
      </SectionErrorBoundary>,
    )

    expect(screen.getByText('fallback: transient')).toBeTruthy()

    // The underlying condition clears — a dropped listener reconnecting, a
    // 5xx not repeating — *before* the retry click, the same as a real
    // transient failure. Only then does clicking "Try again" matter.
    shouldThrow = false
    act(() => {
      retry?.()
    })

    expect(screen.getByText('recovered')).toBeTruthy()
  })

  it('stops remounting a child that always throws once the reset budget is spent — the loop guard', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRender = vi.fn()

    function CountedAlwaysThrows(): null {
      onRender()
      throw new Error('boom')
    }

    let retry: (() => void) | undefined
    render(
      <SectionErrorBoundary
        fallback={(_error, r) => {
          retry = r
          return <div>fallback</div>
        }}
        onCatch={() => {}}
      >
        <CountedAlwaysThrows />
      </SectionErrorBoundary>,
    )

    // Not asserted as exactly 1: React's development build re-invokes a
    // throwing component's render an extra time to capture a clean component
    // stack for `componentDidCatch`, so even the very first mount renders
    // more than once. What this test actually cares about is growth, not the
    // absolute count — captured below, after retrying well past any
    // reasonable budget.
    const initialRenders = onRender.mock.calls.length
    expect(initialRenders).toBeGreaterThan(0)

    // Retry well past any reasonable budget. Each retry that is still honored
    // remounts the child (another render); once the budget is spent, `retry`
    // itself becomes `undefined` and further calls are no-ops — this loop
    // does not know or hardcode `MAX_RESETS`, it just drives the boundary
    // until it stops offering a retry.
    for (let i = 0; i < 20; i++) {
      act(() => {
        retry?.()
      })
    }

    expect(retry).toBeUndefined()
    const rendersOnceExhausted = onRender.mock.calls.length
    // The budget was genuinely spent remounting the child, not exhausted
    // instantly — otherwise the "stops growing" assertion below would be
    // trivially true for the wrong reason.
    expect(rendersOnceExhausted).toBeGreaterThan(initialRenders)

    // The assertion that matters: one more attempted retry (a no-op, since
    // `retry` is undefined) must not grow the render count any further.
    // Unbounded remounting here would be strictly worse than latching, since
    // this same boundary sits in a provider mounted for the whole tab.
    act(() => {
      retry?.()
    })
    expect(onRender).toHaveBeenCalledTimes(rendersOnceExhausted)
  })

  it('calls onCatch once per catch, not once per render of the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCatch = vi.fn()

    const {rerender} = render(
      <SectionErrorBoundary fallback={<div>fallback</div>} onCatch={onCatch}>
        <AlwaysThrows />
      </SectionErrorBoundary>,
    )

    expect(onCatch).toHaveBeenCalledTimes(1)

    // Re-rendering the boundary's parent (the fallback is a static node here,
    // not a function reading any per-render value) must not catch again —
    // `render()` just returns the already-caught fallback; nothing here
    // should re-invoke `children` or `componentDidCatch`.
    rerender(
      <SectionErrorBoundary fallback={<div>fallback</div>} onCatch={onCatch}>
        <AlwaysThrows />
      </SectionErrorBoundary>,
    )

    expect(onCatch).toHaveBeenCalledTimes(1)
  })

  it('gives two boundaries around two different always-throwing children independent reset budgets', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    let retryA: (() => void) | undefined
    let retryB: (() => void) | undefined

    render(
      <>
        <SectionErrorBoundary
          fallback={(_error, r) => {
            retryA = r
            return <div>A fallback</div>
          }}
          onCatch={() => {}}
        >
          <AlwaysThrows />
        </SectionErrorBoundary>
        <SectionErrorBoundary
          fallback={(_error, r) => {
            retryB = r
            return <div>B fallback</div>
          }}
          onCatch={() => {}}
        >
          <AlwaysThrows />
        </SectionErrorBoundary>
      </>,
    )

    // Spend A's entire budget. B is never touched.
    for (let i = 0; i < 20; i++) {
      act(() => {
        retryA?.()
      })
    }
    expect(retryA).toBeUndefined()

    // B's own budget is untouched by A's — two sources failing do not share
    // one counter.
    expect(retryB).toBeTypeOf('function')
  })
})
