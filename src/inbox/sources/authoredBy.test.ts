import {type SanityClient} from '@sanity/client'
import {describe, expect, it, vi} from 'vitest'

import {fetchDocumentAuthors} from './authoredBy'

// Fixture lines captured against the real test dataset for plan 024's Step
// 1 (see the plan file's own `## Findings — plan 024`): the transaction log,
// requested without an `authors` filter, arrives oldest-first and carries
// the author's user id under a plain `author` key.
const CREATE_LINE =
  '{"id":"1774y2HB1zXj7U6P8HADiY","timestamp":"2026-09-09T07:32:50.816551Z","author":"pvreWV4l3","mutations":[{"create":{"_id":"drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9"}}],"documentIDs":["drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9"],"sequenceNumber":"0"}'
const PATCH_LINE_1 =
  '{"id":"FAOh67P1TtSR5s76P6Dw3z","timestamp":"2026-09-15T19:54:07.689993Z","author":"pvreWV4l3","mutations":[{"patch":{"id":"drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9","unsetIsEmpty":false}}],"documentIDs":["drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9"],"sequenceNumber":"0"}'
const PATCH_LINE_2 =
  '{"id":"FAOh67P1TtSR5s76P6E2H0","timestamp":"2026-09-15T19:54:51.334611Z","author":"anotherUser1","mutations":[{"patch":{"id":"drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9","unsetIsEmpty":false}}],"documentIDs":["drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9"],"sequenceNumber":"0"}'
const OTHER_DOC_LINE =
  '{"id":"7ROVCEO16GacwiuJkmHnI9","timestamp":"2026-09-09T07:32:50.830918Z","author":"pvreWV4l3","mutations":[{"create":{"_id":"drafts.859d0508-b162-4cbd-b959-84da7c87c5d6"}}],"documentIDs":["drafts.859d0508-b162-4cbd-b959-84da7c87c5d6"],"sequenceNumber":"0"}'

function stubClient(response: string): {client: SanityClient; request: ReturnType<typeof vi.fn>} {
  const request = vi.fn().mockResolvedValue(response)
  return {client: {config: () => ({dataset: 'production'}), request} as unknown as SanityClient, request}
}

describe('fetchDocumentAuthors', () => {
  it('makes no request for an empty document id list', async () => {
    const {client, request} = stubClient('')
    const authors = await fetchDocumentAuthors(client, [])
    expect(authors.size).toBe(0)
    expect(request).not.toHaveBeenCalled()
  })

  it('reads a single line into a single-author, single-document map', async () => {
    const authors = await fetchDocumentAuthors(stubClient(CREATE_LINE).client, [
      'drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9',
    ])
    expect(authors.get('drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9')).toEqual(['pvreWV4l3'])
  })

  it('orders a document with several authors most-recent-first, from oldest-first lines', async () => {
    const response = [CREATE_LINE, PATCH_LINE_1, PATCH_LINE_2].join('\n')
    const authors = await fetchDocumentAuthors(stubClient(response).client, [
      'drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9',
    ])
    // PATCH_LINE_2 (anotherUser1) is the newest timestamp, so it leads.
    expect(authors.get('drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9')).toEqual([
      'anotherUser1',
      'pvreWV4l3',
    ])
  })

  it('dedupes an author who edited the same document twice, keeping their most recent position', async () => {
    const response = [CREATE_LINE, PATCH_LINE_1].join('\n')
    const authors = await fetchDocumentAuthors(stubClient(response).client, [
      'drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9',
    ])
    expect(authors.get('drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9')).toEqual(['pvreWV4l3'])
  })

  it('keeps a malformed line from losing the rest of the answer', async () => {
    const response = [CREATE_LINE, 'not json', PATCH_LINE_2].join('\n')
    const authors = await fetchDocumentAuthors(stubClient(response).client, [
      'drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9',
    ])
    expect(authors.get('drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9')).toEqual([
      'anotherUser1',
      'pvreWV4l3',
    ])
  })

  it('keeps each document in a multi-document batch separate', async () => {
    const response = [CREATE_LINE, OTHER_DOC_LINE].join('\n')
    const authors = await fetchDocumentAuthors(stubClient(response).client, [
      'drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9',
      'drafts.859d0508-b162-4cbd-b959-84da7c87c5d6',
    ])
    expect(authors.get('drafts.d1c0286d-a30c-4d91-9712-aa47560dcbe9')).toEqual(['pvreWV4l3'])
    expect(authors.get('drafts.859d0508-b162-4cbd-b959-84da7c87c5d6')).toEqual(['pvreWV4l3'])
  })
})
