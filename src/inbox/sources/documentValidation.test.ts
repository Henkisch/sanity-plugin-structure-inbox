import {describe, expect, it} from 'vitest'

import {collectReferenceIds, formatValidationPath, mapWithConcurrency, summarizeErrors} from './documentValidation'

describe('collectReferenceIds', () => {
  it('finds a top-level reference', () => {
    const ids = new Set<string>()
    collectReferenceIds({author: {_type: 'reference', _ref: 'author-1'}}, ids)
    expect(ids).toEqual(new Set(['author-1']))
  })

  it('finds a reference nested inside an array', () => {
    const ids = new Set<string>()
    collectReferenceIds({tags: [{_type: 'reference', _ref: 'tag-1'}, {_type: 'reference', _ref: 'tag-2'}]}, ids)
    expect(ids).toEqual(new Set(['tag-1', 'tag-2']))
  })

  it('finds an image asset reference', () => {
    const ids = new Set<string>()
    collectReferenceIds({hero: {_type: 'image', asset: {_type: 'reference', _ref: 'image-abc'}}}, ids)
    expect(ids).toEqual(new Set(['image-abc']))
  })

  it('dedupes the same reference found twice', () => {
    const ids = new Set<string>()
    collectReferenceIds(
      {a: {_type: 'reference', _ref: 'x'}, b: {_type: 'reference', _ref: 'x'}},
      ids,
    )
    expect(ids).toEqual(new Set(['x']))
  })

  it('does nothing for a document with no references', () => {
    const ids = new Set<string>()
    collectReferenceIds({title: 'Plain doc', count: 3}, ids)
    expect(ids.size).toBe(0)
  })
})

describe('formatValidationPath', () => {
  it('renders a plain field path', () => {
    expect(formatValidationPath(['title'])).toBe('title')
  })

  it('renders a nested field path', () => {
    expect(formatValidationPath(['hero', 'alt'])).toBe('hero.alt')
  })

  it('renders a keyed array item', () => {
    expect(formatValidationPath(['items', {_key: 'abc123'}, 'name'])).toBe('items.[abc123].name')
  })

  it('renders an empty path as an empty string', () => {
    expect(formatValidationPath([])).toBe('')
  })
})

describe('summarizeErrors', () => {
  it('returns null when the result passed', () => {
    expect(summarizeErrors({status: 'passed', markers: []})).toBeNull()
  })

  it('returns null when only warnings are present, never an error', () => {
    expect(
      summarizeErrors({
        status: 'failed',
        markers: [{level: 'warning', message: 'Consider adding a description', path: ['description']}],
      }),
    ).toBeNull()
  })

  it('summarizes one error', () => {
    expect(
      summarizeErrors({status: 'failed', markers: [{level: 'error', message: 'Required', path: ['title']}]}),
    ).toBe('title: Required')
  })

  it('joins several errors, ignoring any warnings mixed in', () => {
    expect(
      summarizeErrors({
        status: 'failed',
        markers: [
          {level: 'error', message: 'Required', path: ['title']},
          {level: 'warning', message: 'Consider a shorter title', path: ['title']},
          {level: 'error', message: 'Required', path: ['hero', 'alt']},
        ],
      }),
    ).toBe('title: Required · hero.alt: Required')
  })
})

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
})
