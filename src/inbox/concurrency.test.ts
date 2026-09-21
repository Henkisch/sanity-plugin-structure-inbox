import {describe, expect, it} from 'vitest'

import {mapWithConcurrency} from './concurrency'

describe('mapWithConcurrency', () => {
  it('maps every item, preserving order regardless of resolution order', async () => {
    const results = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n))
      return n * 10
    })
    expect(results).toEqual([30, 10, 20])
  })

  it('never runs more than `concurrency` mappers at once', async () => {
    let active = 0
    let maxActive = 0

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return null
    })

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('returns an empty array for an empty input, calling the mapper zero times', async () => {
    let calls = 0
    const results = await mapWithConcurrency<number, number>([], 3, async (n) => {
      calls += 1
      return n
    })
    expect(results).toEqual([])
    expect(calls).toBe(0)
  })

  it('rejects the whole call as soon as any mapper rejects, like `Promise.all`', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('mapper failed')
        return n
      }),
    ).rejects.toThrow('mapper failed')
  })

  it('still maps every item when `concurrency` is 0', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 10)
    expect(results).toEqual([10, 20, 30])
  })
})
