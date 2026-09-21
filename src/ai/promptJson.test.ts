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

  it('skips a decoy brace that names the keys in prose and parses the real payload after it', () => {
    const raw =
      'I\'ll return a JSON object with the keys {id, label, reason}: {"id": "abc", "label": "x", "reason": "y"}'
    expect(parseJsonResponse<{id: string; label: string; reason: string}>(raw)).toEqual({
      id: 'abc',
      label: 'x',
      reason: 'y',
    })
  })

  it('returns the first candidate that parses, even when a later one also would (first-valid-candidate wins)', () => {
    const raw = 'First guess: {"id": "wrong"}. Actual answer: {"id": "right"}'
    expect(parseJsonResponse<{id: string}>(raw)).toEqual({id: 'wrong'})
  })

  it('returns null for a pure-prose answer with no candidate braces at all', () => {
    const raw = 'The assessment could not be completed for this document.'
    expect(parseJsonResponse(raw)).toBeNull()
  })

  it('skips a candidate that never closes and parses the valid JSON that follows it', () => {
    const raw = 'Note: [1, 2, 3 and then the real payload is {"ok": true}'
    expect(parseJsonResponse<{ok: boolean}>(raw)).toEqual({ok: true})
  })

  it('gives up past the candidate cap rather than scanning indefinitely for a valid payload', () => {
    const raw = '{'.repeat(25) + '"ok": true}'
    expect(parseJsonResponse<{ok: boolean}>(raw)).toBeNull()
  })

  it('still parses an array answer when it is not the first candidate', () => {
    const raw = 'Guess: {oops} then the list is [1, 2, 3]'
    expect(parseJsonResponse<number[]>(raw)).toEqual([1, 2, 3])
  })
})
