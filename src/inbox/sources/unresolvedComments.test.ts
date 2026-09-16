import {describe, expect, it} from 'vitest'

import {firstLineOfMessage, firstMentionedUser, mentionsUser} from './unresolvedComments'

function span(text: string) {
  return {_type: 'span', text}
}

function mention(userId: string) {
  return {_type: 'mention', userId}
}

function block(...children: {_type: string; text?: string; userId?: string}[]) {
  return {_type: 'block', children}
}

describe('firstLineOfMessage', () => {
  it('joins a block of spans and mentions into one line', () => {
    const message = [block(span('Please double-check this title '), mention('user-1'), span(' '))]
    expect(firstLineOfMessage(message)).toBe('Please double-check this title')
  })

  it('takes only the first line of a multi-line comment', () => {
    const message = [block(span('First line\nSecond line'))]
    expect(firstLineOfMessage(message)).toBe('First line')
  })

  it('falls back to a placeholder for an empty message', () => {
    expect(firstLineOfMessage([block(span(''))])).toBe('(no text)')
    expect(firstLineOfMessage([])).toBe('(no text)')
  })

  it('handles a block with no children', () => {
    expect(firstLineOfMessage([{_type: 'block'}])).toBe('(no text)')
  })
})

describe('mentionsUser', () => {
  it('finds a mention anywhere across the message blocks', () => {
    const message = [block(span('Hey ')), block(mention('user-1'), span(' check this'))]
    expect(mentionsUser(message, 'user-1')).toBe(true)
  })

  it('returns false when the user is never mentioned', () => {
    const message = [block(span('Hey '), mention('user-2'))]
    expect(mentionsUser(message, 'user-1')).toBe(false)
  })

  it('returns false for a message with no mentions at all', () => {
    expect(mentionsUser([block(span('Just text'))], 'user-1')).toBe(false)
  })
})

describe('firstMentionedUser', () => {
  it('returns the one user mentioned, across blocks', () => {
    const message = [block(span('Hey ')), block(mention('user-1'), span(' check this'))]
    expect(firstMentionedUser(message)).toBe('user-1')
  })

  it('returns undefined when more than one distinct user is mentioned', () => {
    const message = [block(mention('user-1'), mention('user-2'))]
    expect(firstMentionedUser(message)).toBeUndefined()
  })

  it('returns the same user when mentioned more than once', () => {
    const message = [block(mention('user-1')), block(mention('user-1'))]
    expect(firstMentionedUser(message)).toBe('user-1')
  })

  it('returns undefined for a message with no mentions', () => {
    expect(firstMentionedUser([block(span('Just text'))])).toBeUndefined()
  })
})
