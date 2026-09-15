import {describe, expect, it} from 'vitest'

import {parseAssessment} from './assessment'

describe('parseAssessment', () => {
  it('parses a valid {message, tone}', () => {
    expect(parseAssessment({message: 'Looks ready to publish.', tone: 'positive'})).toEqual({
      message: 'Looks ready to publish.',
      tone: 'positive',
    })
  })

  it('parses a valid {message} with no tone', () => {
    expect(parseAssessment({message: 'Looks ready to publish.'})).toEqual({
      message: 'Looks ready to publish.',
    })
  })

  it('drops an unrecognised tone while keeping the message', () => {
    expect(parseAssessment({message: 'Needs attention.', tone: 'urgent'})).toEqual({
      message: 'Needs attention.',
    })
  })

  it('returns null for a non-string message', () => {
    expect(parseAssessment({message: 42})).toBeNull()
  })

  it('returns null for a whitespace-only message', () => {
    expect(parseAssessment({message: '   '})).toBeNull()
  })

  it('returns null for null, a bare string, or an array', () => {
    expect(parseAssessment(null)).toBeNull()
    expect(parseAssessment('just a string')).toBeNull()
    expect(parseAssessment(['a', 'b'])).toBeNull()
  })
})
