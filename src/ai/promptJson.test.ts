import {describe, expect, it} from 'vitest'

import {parseJsonResponse} from './promptJson'

describe('parseJsonResponse', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonResponse<{a: number}>('{"a": 1}')).toEqual({a: 1})
  })

  it('parses JSON inside ```json fences', () => {
    const raw = '```json\n{"a": 1}\n```'
    expect(parseJsonResponse<{a: number}>(raw)).toEqual({a: 1})
  })

  it('parses JSON preceded by a sentence of prose', () => {
    const raw = 'Here is the answer:\n{"a": 1}'
    expect(parseJsonResponse<{a: number}>(raw)).toEqual({a: 1})
  })

  it('returns null for pure prose with no JSON', () => {
    expect(parseJsonResponse('This document looks ready to publish.')).toBeNull()
  })

  it('returns null for truncated/malformed JSON, without throwing', () => {
    expect(parseJsonResponse('{"a": 1,')).toBeNull()
  })

  it('parses a JSON array answer', () => {
    expect(parseJsonResponse<number[]>('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('parses correctly when a string value inside the JSON contains a closing brace', () => {
    const raw = 'Sure — {"reason": "looks unfinished (missing a hero image}"}'
    expect(parseJsonResponse<{reason: string}>(raw)).toEqual({
      reason: 'looks unfinished (missing a hero image}',
    })
  })
})
