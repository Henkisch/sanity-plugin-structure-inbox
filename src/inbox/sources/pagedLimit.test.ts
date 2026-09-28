import {act, renderHook} from '@testing-library/react'
import {describe, expect, it} from 'vitest'

import {allocate, MAX_LOADED_ROWS, usePagedLimit} from './pagedLimit'

describe('allocate', () => {
  it('splits in proportion to what each bucket has left, summing exactly', () => {
    const shares = allocate(50, [400, 100])
    expect(shares).toEqual([40, 10])
    expect(allocate(50, [7, 7, 7]).reduce((a, b) => a + b, 0)).toBe(21)
  })

  it('never gives a bucket more than it has', () => {
    expect(allocate(50, [3, 1000])).toEqual([0, 50])
    expect(allocate(1000, [3, 40])).toEqual([3, 40])
  })

  it('rounds so the total is still exact', () => {
    const shares = allocate(10, [1, 1, 1])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(3)
    const uneven = allocate(10, [5, 5, 5])
    expect(uneven.reduce((a, b) => a + b, 0)).toBe(10)
    expect(Math.max(...uneven) - Math.min(...uneven)).toBeLessThanOrEqual(1)
  })

  it('handles nothing to give and nothing to take', () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0])
    expect(allocate(10, [])).toEqual([])
    expect(allocate(10, [0, 0])).toEqual([0, 0])
  })
})

describe('usePagedLimit', () => {
  it('starts at the configured limit and adds what loadMore asks for', () => {
    const {result} = renderHook(() => usePagedLimit(20))
    expect(result.current.limit).toBe(20)
    act(() => result.current.loadMore?.(35))
    expect(result.current.limit).toBe(55)
  })

  it('keeps loadMore stable, so reporting it never churns', () => {
    const {result} = renderHook(() => usePagedLimit(20))
    const first = result.current.loadMore
    act(() => result.current.loadMore?.(50))
    expect(result.current.loadMore).toBe(first)
  })

  it('stops at the row ceiling and withdraws loadMore there', () => {
    const {result} = renderHook(() => usePagedLimit(20))
    act(() => result.current.loadMore?.(10_000))
    expect(result.current.limit).toBe(MAX_LOADED_ROWS)
    expect(result.current.loadMore).toBeUndefined()
  })

  it('never lowers a configured limit that is already above the ceiling', () => {
    const {result} = renderHook(() => usePagedLimit(MAX_LOADED_ROWS + 100))
    expect(result.current.limit).toBe(MAX_LOADED_ROWS + 100)
    expect(result.current.loadMore).toBeUndefined()
  })
})
