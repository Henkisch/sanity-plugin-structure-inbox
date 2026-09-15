import {describe, expect, it} from 'vitest'

import {assignmentDocId} from './assignmentStore'

// Sanity document ids: start with an alphanumeric, only alphanumeric/`._-`
// after that, capped at 128 characters total.
const VALID_DOC_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

describe('assignmentDocId', () => {
  it('stays a valid, short document id even for a target that embeds a real URL', () => {
    // The exact shape that broke live: a link-checker finding's key embeds
    // the field path and the full broken URL. Sanitizing that in place (the
    // original implementation) blew past Sanity's 128-character document id
    // limit and failed with "is not a valid document ID" — silently, for
    // this one finding kind only (a reference finding's short key stayed
    // under the limit, which is why this went unnoticed at first).
    const longTargetId =
      'link-ceb03ad4-15f0-425b-a90d-2c9e258272bb-body-' +
      'https://api.github.com/repos/anthropics/definitely-nonexistent-repo-xyz123-demo'

    const id = assignmentDocId('structureInbox.linkCheckerAssignment', longTargetId)

    expect(id.length).toBeLessThanOrEqual(128)
    expect(id).toMatch(VALID_DOC_ID)
  })

  it('is deterministic — the same target always maps to the same id', () => {
    const a = assignmentDocId('structureInbox.draftAssignment', 'some-draft-id')
    const b = assignmentDocId('structureInbox.draftAssignment', 'some-draft-id')
    expect(a).toBe(b)
  })

  it('gives different targets different ids', () => {
    const a = assignmentDocId('structureInbox.draftAssignment', 'draft-one')
    const b = assignmentDocId('structureInbox.draftAssignment', 'draft-two')
    expect(a).not.toBe(b)
  })

  it('keeps a short, ordinary target id valid too', () => {
    const id = assignmentDocId('structureInbox.draftAssignment', 'a1b2c3')
    expect(id).toMatch(VALID_DOC_ID)
  })
})
