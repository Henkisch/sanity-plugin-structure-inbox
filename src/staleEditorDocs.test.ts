import {describe, expect, it} from 'vitest'

import {findStaleEditorDocuments} from './staleEditorDocs'

describe('findStaleEditorDocuments', () => {
  it('does not return a document whose user id is in activeUserIds', () => {
    const docs = [{_id: 'structureInbox.dismissals.alice', _type: 'structureInbox.dismissals'}]

    expect(findStaleEditorDocuments(docs, ['alice'])).toEqual([])
  })

  it('returns a document whose user id is not in activeUserIds, as its own _id', () => {
    const docs = [{_id: 'structureInbox.dismissals.bob', _type: 'structureInbox.dismissals'}]

    expect(findStaleEditorDocuments(docs, ['alice'])).toEqual(['structureInbox.dismissals.bob'])
  })

  it('handles all three document types identically for the same user id', () => {
    const staleDocs = [
      {_id: 'structureInbox.dismissals.bob', _type: 'structureInbox.dismissals'},
      {_id: 'structureInbox.snoozes.bob', _type: 'structureInbox.snoozes'},
      {_id: 'structureInbox.todos.bob', _type: 'structureInbox.todos'},
    ]

    expect(findStaleEditorDocuments(staleDocs, ['alice'])).toEqual([
      'structureInbox.dismissals.bob',
      'structureInbox.snoozes.bob',
      'structureInbox.todos.bob',
    ])

    const activeDocs = [
      {_id: 'structureInbox.dismissals.alice', _type: 'structureInbox.dismissals'},
      {_id: 'structureInbox.snoozes.alice', _type: 'structureInbox.snoozes'},
      {_id: 'structureInbox.todos.alice', _type: 'structureInbox.todos'},
    ]

    expect(findStaleEditorDocuments(activeDocs, ['alice'])).toEqual([])
  })

  it('behaves sanely on an empty docs array, or an empty activeUserIds array', () => {
    const docs = [{_id: 'structureInbox.dismissals.alice', _type: 'structureInbox.dismissals'}]

    expect(findStaleEditorDocuments([], ['alice'])).toEqual([])
    expect(findStaleEditorDocuments(docs, [])).toEqual(['structureInbox.dismissals.alice'])
  })

  it('round-trips a user id containing a literal "." via slice, not a naive split on the first "."', () => {
    const docs = [{_id: 'structureInbox.dismissals.alice.smith', _type: 'structureInbox.dismissals'}]

    expect(findStaleEditorDocuments(docs, ['alice.smith'])).toEqual([])
    expect(findStaleEditorDocuments(docs, ['alice'])).toEqual(['structureInbox.dismissals.alice.smith'])
  })
})
