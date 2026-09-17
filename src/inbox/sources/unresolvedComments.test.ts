import {describe, expect, it} from 'vitest'

import {
  type CommentRow,
  commentsFetchLimit,
  firstLineOfMessage,
  firstMentionedUser,
  mentionsUser,
  selectUnresolvedComments,
} from './unresolvedComments'

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

describe('commentsFetchLimit', () => {
  it('over-fetches when narrowing to mentions of the current editor', () => {
    // The query can only ask the dataset for "the newest N threads
    // team-wide," never "the newest N that mention me" — so `onlyMine`
    // needs a wider raw fetch to filter from, the same reasoning
    // `unpublishedDrafts.ts`'s own overfetch multiplier uses.
    expect(commentsFetchLimit(20, true)).toBe(100)
  })

  it('fetches exactly the configured limit when not narrowing to mentions', () => {
    expect(commentsFetchLimit(20, false)).toBe(20)
  })
})

function commentRow(id: string, message: {_type: string; text?: string; userId?: string}[][]): CommentRow {
  return {
    _id: id,
    _createdAt: '2026-01-01T00:00:00.000Z',
    message: message.map((children) => ({_type: 'block', children})),
    target: {document: {_ref: 'post-1'}, documentType: 'post'},
  }
}

describe('selectUnresolvedComments', () => {
  it('finds a real mention of the current editor sitting outside the query result\'s own natural order, once the caller over-fetched for it', () => {
    // The actual bug this regresses: without `commentsFetchLimit`'s own
    // overfetch, a real @mention sitting past the newest `limit` threads
    // team-wide was silently invisible to the mentioned editor — nothing
    // wrong-looking about the UI, no error, just a missing row. This test
    // simulates the caller having already over-fetched (as `useItems()`
    // now does) and proves the mention still surfaces once it does.
    const rows = [
      ...Array.from({length: 19}, (_, i) => commentRow(`other-${i}`, [[{_type: 'span', text: 'noise'}]])),
      commentRow('mentions-me', [[{_type: 'mention', userId: 'user-1'}, {_type: 'span', text: ' check this'}]]),
    ]

    const result = selectUnresolvedComments(rows, true, 'user-1', 20)

    expect(result.map((row) => row._id)).toEqual(['mentions-me'])
  })

  it('re-caps to the configured limit after filtering, not the wider over-fetched window', () => {
    const rows = Array.from({length: 30}, (_, i) =>
      commentRow(`mine-${i}`, [[{_type: 'mention', userId: 'user-1'}]]),
    )

    const result = selectUnresolvedComments(rows, true, 'user-1', 20)

    expect(result).toHaveLength(20)
  })

  it('does not filter at all when onlyMine is off', () => {
    const rows = [commentRow('a', [[{_type: 'span', text: 'x'}]]), commentRow('b', [[{_type: 'span', text: 'y'}]])]

    const result = selectUnresolvedComments(rows, false, 'user-1', 20)

    expect(result.map((row) => row._id)).toEqual(['a', 'b'])
  })
})
