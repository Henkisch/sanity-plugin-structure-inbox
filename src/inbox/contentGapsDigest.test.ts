import {describe, expect, it, vi} from 'vitest'

import {
  findSampleFieldName,
  formatContentGapsDigest,
  getRealDocumentTypeNames,
  surveyContentTypes,
  type ContentTypeSummary,
} from './contentGapsDigest'

// `isDocumentSchemaType` (real `@sanity/types` export) requires
// `jsonType === 'object'` plus a `.type` chain that reaches a type named
// `document` — mirrors how a real schema type's own intrinsic chain works.
const DOCUMENT_INTRINSIC = {name: 'document'}
const OBJECT_INTRINSIC = {name: 'object'}

function schemaWith(types: {name: string; title?: string; isDocument?: boolean; fields?: {name: string; type: {jsonType?: string}}[]}[]) {
  const byName = new Map(types.map((type) => [type.name, type]))
  return {
    getTypeNames: () => [...byName.keys()],
    get: (name: string) => {
      const type = byName.get(name)
      if (!type) return undefined
      return {
        name: type.name,
        title: type.title,
        fields: type.fields,
        jsonType: 'object',
        type: type.isDocument === false ? OBJECT_INTRINSIC : DOCUMENT_INTRINSIC,
      }
    },
  }
}

describe('getRealDocumentTypeNames', () => {
  it('keeps real document types, sorted by title', () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post'},
      {name: 'author', title: 'Author'},
    ])
    expect(getRealDocumentTypeNames(schema)).toEqual([
      {name: 'author', title: 'Author'},
      {name: 'post', title: 'Post'},
    ])
  })

  it('excludes hidden (sanity./system./media.) and non-document types', () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post'},
      {name: 'sanity.imageAsset', title: 'Image'},
      {name: 'seoFields', title: 'SEO fields', isDocument: false},
    ])
    expect(getRealDocumentTypeNames(schema)).toEqual([{name: 'post', title: 'Post'}])
  })

  it('falls back to the type name when no title is set', () => {
    const schema = schemaWith([{name: 'post'}])
    expect(getRealDocumentTypeNames(schema)).toEqual([{name: 'post', title: 'post'}])
  })
})

describe('findSampleFieldName', () => {
  it('returns the first string-jsonType field', () => {
    const schema = schemaWith([
      {
        name: 'post',
        fields: [
          {name: 'publishedAt', type: {jsonType: 'string'}},
          {name: 'title', type: {jsonType: 'string'}},
        ],
      },
    ])
    expect(findSampleFieldName(schema, 'post')).toBe('publishedAt')
  })

  it('skips non-string fields', () => {
    const schema = schemaWith([
      {name: 'post', fields: [{name: 'featured', type: {jsonType: 'boolean'}}]},
    ])
    expect(findSampleFieldName(schema, 'post')).toBeUndefined()
  })

  it('returns undefined for a type with no fields', () => {
    const schema = schemaWith([{name: 'post'}])
    expect(findSampleFieldName(schema, 'post')).toBeUndefined()
  })

  it('returns undefined for an unknown type', () => {
    const schema = schemaWith([])
    expect(findSampleFieldName(schema, 'missing')).toBeUndefined()
  })
})

describe('surveyContentTypes', () => {
  it('samples only types that have documents and an eligible field', async () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]},
      {name: 'caseStudy', title: 'Case study', fields: [{name: 'title', type: {jsonType: 'string'}}]},
    ])

    // `getRealDocumentTypeNames` sorts by title — "Case study" is surveyed
    // before "Post" regardless of the order passed to `schemaWith`.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(0) // count(caseStudy)
      .mockResolvedValueOnce(3) // count(post)
      .mockResolvedValueOnce(['Post A', 'Post B', 'Post C']) // post titles

    await expect(surveyContentTypes({fetch}, schema)).resolves.toEqual([
      {type: 'caseStudy', title: 'Case study', count: 0, samples: []},
      {type: 'post', title: 'Post', count: 3, samples: ['Post A', 'Post B', 'Post C']},
    ])
  })

  it('drops blank/null sample values rather than passing them through', async () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]},
    ])
    const fetch = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(['Real title', '', null])

    await expect(surveyContentTypes({fetch}, schema)).resolves.toEqual([
      {type: 'post', title: 'Post', count: 2, samples: ['Real title']},
    ])
  })
})

describe('formatContentGapsDigest', () => {
  it('formats one line per type, samples inlined', () => {
    const summaries: ContentTypeSummary[] = [
      {type: 'post', title: 'Post', count: 2, samples: ['Hello world', 'Second post']},
      {type: 'caseStudy', title: 'Case study', count: 0, samples: []},
    ]
    expect(formatContentGapsDigest(summaries)).toBe(
      '- Post (2 documents): Hello world | Second post\n- Case study (0 documents)',
    )
  })

  it('uses singular "document" for a count of exactly one', () => {
    expect(formatContentGapsDigest([{type: 'post', title: 'Post', count: 1, samples: []}])).toBe(
      '- Post (1 document)',
    )
  })
})
