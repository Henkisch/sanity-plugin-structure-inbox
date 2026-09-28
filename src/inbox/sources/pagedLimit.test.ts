import {act, renderHook} from '@testing-library/react'
import {describe, expect, it} from 'vitest'

import {MAX_PAGED_LIMIT, usePagedLimit} from './pagedLimit'

describe('usePagedLimit', () => {
  it('starts at the configured limit and adds one page per loadMore', () => {
    const {result} = renderHook(() => usePagedLimit(20))
    expect(result.current.limit).toBe(20)
    act(() => result.current.loadMore?.())
    expect(result.current.limit).toBe(40)
  })

  it('keeps loadMore stable, so reporting it never churns', () => {
    const {result} = renderHook(() => usePagedLimit(20))
    const first = result.current.loadMore
    act(() => result.current.loadMore?.())
    expect(result.current.loadMore).toBe(first)
  })

  it('stops at the ceiling and withdraws loadMore there', () => {
    const {result} = renderHook(() => usePagedLimit(90))
    act(() => result.current.loadMore?.())
    act(() => result.current.loadMore?.())
    expect(result.current.limit).toBe(MAX_PAGED_LIMIT)
    expect(result.current.loadMore).toBeUndefined()
  })

  it('never lowers a configured limit that is already above the ceiling', () => {
    const {result} = renderHook(() => usePagedLimit(500))
    expect(result.current.limit).toBe(500)
    expect(result.current.loadMore).toBeUndefined()
  })
})
