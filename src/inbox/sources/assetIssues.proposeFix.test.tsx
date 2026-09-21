import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {Subject} from 'rxjs'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {assetIssues} from './assetIssues'

/**
 * The fix path end to end: what `proposeFix` decides, and what it actually
 * patches when someone clicks Apply.
 *
 * The pure half of the decision (`suggestAltText`) has its own tests in
 * `assetIssues.test.ts`. This file covers the parts only a rendered hook can
 * reach — the re-read guard, the `instantOnly` bound, and the exact mutation
 * — because those are the three that can quietly cost money or write the
 * wrong thing to someone's document.
 */

const documentType = {name: 'document', jsonType: 'object' as const}
const stringType = {name: 'string', jsonType: 'string' as const}
const imageType = {
  name: 'image',
  jsonType: 'object' as const,
  fields: [{name: 'alt', type: stringType}],
}

const personType = {
  name: 'person',
  title: 'Person',
  jsonType: 'object' as const,
  type: documentType,
  fields: [{name: 'portrait', type: imageType}],
}

const {useClientMock, stableSchema} = vi.hoisted(() => ({
  useClientMock: vi.fn(),
  // A single stable reference — a fresh object per call would recompute the
  // whole fetch pipeline on every render.
  stableSchema: {
    getTypeNames: () => ['person'],
    get: (name: string) => (name === 'person' ? personType : undefined),
  },
}))

// `useAssignableUsers` reaches Sanity's own `useUserListWithPermissions`,
// which needs a real Studio `source` context this test has no business
// standing up — assignment is not what any of these assertions are about.
vi.mock('./capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capability')>()),
  useAssignableUsers: () => ({data: undefined}),
}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useSchema: () => stableSchema,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
  }
})

interface StubOptions {
  /** Rows the missing-alt query hands back. */
  missingAlt?: {_id: string; title: string; safeTitle?: string; imageUrl?: string}[]
  /** What the re-read inside `proposeFix` finds at `portrait.alt` right now. */
  currentAlt?: unknown
}

function stubClient({missingAlt = [], currentAlt = null}: StubOptions = {}) {
  const commit = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({commit}))
  const patch = vi.fn(() => ({set}))

  const fetch = vi.fn(async (query: string) => {
    // The `proposeFix` re-read — a single field off a single document.
    if (query.startsWith('*[_id == $id][0].')) return currentAlt
    if (query.includes('!defined(portrait.alt)')) return missingAlt
    if (query.startsWith('count(')) return 0
    return []
  })

  const client = {
    config: () => ({dataset: 'production'}),
    fetch,
    observable: {fetch: vi.fn()},
    listen: vi.fn(() => new Subject()),
    patch,
  } as unknown as SanityClient

  return {client, fetch, patch, set, commit}
}

const PERSON_ROW = {
  _id: 'person-a1b2c3',
  title: 'Daniel Vaziri',
  safeTitle: 'Daniel Vaziri',
  imageUrl: 'https://cdn.sanity.io/images/p/d/abc-800x800.jpg',
}

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
})

async function renderSource(options: Parameters<typeof assetIssues>[0], stub: StubOptions) {
  const stubbed = stubClient(stub)
  useClientMock.mockReturnValue(stubbed.client)

  const source = assetIssues(options)
  const {result} = renderHook(() => source.useItems())
  await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
  return {...stubbed, result}
}

describe('assetIssues proposeFix', () => {
  it('writes the document title into the alt field, and only into that field', async () => {
    const {result, patch, set, commit} = await renderSource(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [PERSON_ROW]},
    )

    const item = result.current.items[0]
    expect(item.quickFixable).toBe(true)

    const proposal = await result.current.proposeFix!(item)
    expect(proposal?.summary).toBe('Set alt text to "Daniel Vaziri"')

    await proposal!.apply()
    // The row's own `_id`, verbatim — not a published/draft normalization of
    // it. A draft row must patch the draft, which is the same rule stated the
    // other way round.
    expect(patch).toHaveBeenCalledWith('person-a1b2c3')
    expect(set).toHaveBeenCalledWith({'portrait.alt': 'Daniel Vaziri'})
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('patches the draft id when the row is a draft', async () => {
    const {result, patch} = await renderSource(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{...PERSON_ROW, _id: 'drafts.person-a1b2c3'}]},
    )

    const proposal = await result.current.proposeFix!(result.current.items[0])
    await proposal!.apply()
    expect(patch).toHaveBeenCalledWith('drafts.person-a1b2c3')
  })

  it('proposes nothing when the alt text was filled in by hand since the query ran', async () => {
    const {result, patch} = await renderSource(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [PERSON_ROW], currentAlt: 'Already written by a human'},
    )

    expect(await result.current.proposeFix!(result.current.items[0])).toBeNull()
    expect(patch).not.toHaveBeenCalled()
  })

  it('treats whitespace-only existing alt text as still missing', async () => {
    const {result} = await renderSource(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [PERSON_ROW], currentAlt: '   '},
    )

    expect(await result.current.proposeFix!(result.current.items[0])).not.toBeNull()
  })

  it('offers nothing on a document with no title of its own', async () => {
    const {result} = await renderSource(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{_id: 'person-x', title: 'person-x'}]},
    )

    const item = result.current.items[0]
    expect(item.quickFixable).toBe(false)
    expect(item.fixable).toBe(false)
    expect(await result.current.proposeFix!(item)).toBeNull()
  })

  it('never calls describeImage under instantOnly — the bound the bulk action relies on', async () => {
    const describeImage = vi.fn().mockResolvedValue('A person at a desk')
    const {result, patch} = await renderSource(
      {describeImage},
      {missingAlt: [PERSON_ROW]},
    )

    const item = result.current.items[0]
    // Fixable, but not for free — exactly the row a bulk selection must skip.
    expect(item.fixable).toBe(true)
    expect(item.quickFixable).toBe(false)

    expect(await result.current.proposeFix!(item, {instantOnly: true})).toBeNull()
    expect(describeImage).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('asks describeImage on an explicit click, with a width-capped url and the per-image context', async () => {
    const describeImage = vi.fn().mockResolvedValue('A person at a desk')
    const {result, set} = await renderSource({describeImage}, {missingAlt: [PERSON_ROW]})

    const proposal = await result.current.proposeFix!(result.current.items[0])
    expect(describeImage).toHaveBeenCalledWith({
      documentId: 'person-a1b2c3',
      documentType: 'person',
      fieldName: 'portrait',
      title: 'Daniel Vaziri',
      imageUrl: `${PERSON_ROW.imageUrl}?w=1024&fit=max&auto=format`,
    })

    await proposal!.apply()
    expect(set).toHaveBeenCalledWith({'portrait.alt': 'A person at a desk'})
  })

  it('prefers the free answer and never asks describeImage for a row that has one', async () => {
    const describeImage = vi.fn().mockResolvedValue('A person at a desk')
    const {result} = await renderSource(
      {altFromTitle: ['person.portrait'], describeImage},
      {missingAlt: [PERSON_ROW]},
    )

    const proposal = await result.current.proposeFix!(result.current.items[0])
    expect(proposal?.summary).toBe('Set alt text to "Daniel Vaziri"')
    expect(describeImage).not.toHaveBeenCalled()
  })

  it.each([
    ['nothing at all', null],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['an essay rather than a sentence', 'x'.repeat(301)],
  ])('drops a describeImage answer that is %s', async (_label, answer) => {
    const {result, patch} = await renderSource(
      {describeImage: vi.fn().mockResolvedValue(answer)},
      {missingAlt: [PERSON_ROW]},
    )

    expect(await result.current.proposeFix!(result.current.items[0])).toBeNull()
    expect(patch).not.toHaveBeenCalled()
  })

  it('is not fixable at all when no describeImage is configured and no title is available', async () => {
    const {result} = await renderSource({}, {missingAlt: [PERSON_ROW]})
    expect(result.current.items[0].fixable).toBe(false)
  })
})
