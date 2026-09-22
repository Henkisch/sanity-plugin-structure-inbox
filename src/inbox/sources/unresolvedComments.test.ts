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

/**
 * A *field* comment, in the shape Sanity's own comment `createOperation`
 * writes on its `type === "field"` branch: a `target.path` naming the field,
 * plus a `target.document` reference back into the content dataset.
 *
 * `target.path` is the only thing that tells such a comment apart from a
 * comment on a task, so a fixture without one is not a field comment at all
 * — see `taskCommentRow` below.
 */
function commentRow(id: string, message: {_type: string; text?: string; userId?: string}[][]): CommentRow {
  return {
    _id: id,
    _createdAt: '2026-01-01T00:00:00.000Z',
    message: message.map((children) => ({_type: 'block', children})),
    target: {document: {_ref: 'post-1'}, documentType: 'post', path: {field: 'title'}},
  }
}

/**
 * A *task* comment, in the shape the same function writes on its
 * `type === "task"` branch: no `target.path` at all, and a `documentType` of
 * `tasks.task` whose `_ref` only resolves inside the add-on dataset.
 */
function taskCommentRow(
  id: string,
  message: {_type: string; text?: string; userId?: string}[][],
): CommentRow {
  return {
    _id: id,
    _createdAt: '2026-01-01T00:00:00.000Z',
    message: message.map((children) => ({_type: 'block', children})),
    target: {document: {_ref: 'task-1'}, documentType: 'tasks.task'},
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

  it('keeps a comment left on a document field', () => {
    const rows = [commentRow('field-comment', [[{_type: 'span', text: 'fix this heading'}]])]

    const result = selectUnresolvedComments(rows, false, 'user-1', 20)

    expect(result.map((row) => row._id)).toEqual(['field-comment'])
  })

  it('drops a comment left on a Sanity task, whose row navigated to a tasks.task id registered in no workspace and present in no content dataset', () => {
    const rows = [
      commentRow('field-comment', [[{_type: 'span', text: 'fix this heading'}]]),
      taskCommentRow('task-comment', [[{_type: 'span', text: 'on it'}]]),
    ]

    const result = selectUnresolvedComments(rows, false, 'user-1', 20)

    expect(result.map((row) => row._id)).toEqual(['field-comment'])
  })

  it('drops a task comment that @mentions the current editor — the case onlyMine most wants to get right, and the one that produced the dead row', () => {
    const rows = [taskCommentRow('task-comment', [[{_type: 'mention', userId: 'user-1'}]])]

    const result = selectUnresolvedComments(rows, true, 'user-1', 20)

    expect(result).toEqual([])
  })

  it('does not throw on a row with no target at all', () => {
    const rows = [
      {...commentRow('no-target', [[{_type: 'span', text: 'x'}]]), target: undefined},
    ] as unknown as CommentRow[]

    expect(() => selectUnresolvedComments(rows, false, 'user-1', 20)).not.toThrow()
    expect(selectUnresolvedComments(rows, false, 'user-1', 20)).toEqual([])
  })

  it('drops a row with a target.path but no target.document._ref to navigate to', () => {
    const rows = [
      {
        ...commentRow('no-ref', [[{_type: 'span', text: 'x'}]]),
        target: {document: {}, documentType: 'post', path: {field: 'title'}},
      },
    ] as unknown as CommentRow[]

    const result = selectUnresolvedComments(rows, false, 'user-1', 20)

    expect(result).toEqual([])
  })
})
