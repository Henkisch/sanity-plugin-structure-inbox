import {describe, expect, it, vi} from 'vitest'

import {
  findReferencedTypes,
  findSampleFieldName,
  formatContentGapsDigest,
  getRealDocumentTypeNames,
  strideSample,
  surveyContentTypes,
  type ContentTypeSummary,
} from './projectDigest'

// `isDocumentSchemaType` (real `@sanity/types` export) requires
// `jsonType === 'object'` plus a `.type` chain that reaches a type named
// `document` — mirrors how a real schema type's own intrinsic chain works.
const DOCUMENT_INTRINSIC = {name: 'document'}
const OBJECT_INTRINSIC = {name: 'object'}

function schemaWith(
  types: {
    name: string
    title?: string
    description?: string
    isDocument?: boolean
    fields?: {name: string; type: {jsonType?: string; to?: {name: string}[]}}[]
  }[],
) {
  const byName = new Map(types.map((type) => [type.name, type]))
  return {
    getTypeNames: () => [...byName.keys()],
    get: (name: string) => {
      const type = byName.get(name)
      if (!type) return undefined
      return {
        name: type.name,
        title: type.title,
        description: type.description,
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
    const schema = schemaWith([{name: 'post', fields: [{name: 'featured', type: {jsonType: 'boolean'}}]}])
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

  it('rejects a field name that fails SIMPLE_FIELD_PATH, the same as having no eligible field at all', () => {
    const schema = schemaWith([{name: 'post', fields: [{name: 'bad}name', type: {jsonType: 'string'}}]}])
    expect(findSampleFieldName(schema, 'post')).toBeUndefined()
  })
})

describe('findReferencedTypes', () => {
  it('returns the title of a single referenced type', () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post', fields: [{name: 'author', type: {to: [{name: 'author'}]}}]},
      {name: 'author', title: 'Author'},
    ])
    const realTypesByName = new Map([
      ['post', 'Post'],
      ['author', 'Author'],
    ])
    expect(findReferencedTypes(schema, realTypesByName, 'post')).toEqual(['Author'])
  })

  it('excludes a reference to a type filtered out of the real-types map', () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post', fields: [{name: 'asset', type: {to: [{name: 'sanity.imageAsset'}]}}]},
    ])
    // `sanity.imageAsset` deliberately absent from the map — the same way
    // `getRealDocumentTypeNames` would already have filtered it out as a
    // hidden type before this map was ever built.
    const realTypesByName = new Map([['post', 'Post']])
    expect(findReferencedTypes(schema, realTypesByName, 'post')).toEqual([])
  })

  it('deduplicates the same target type referenced from two different fields', () => {
    const schema = schemaWith([
      {
        name: 'post',
        title: 'Post',
        fields: [
          {name: 'author', type: {to: [{name: 'author'}]}},
          {name: 'coAuthor', type: {to: [{name: 'author'}]}},
        ],
      },
      {name: 'author', title: 'Author'},
    ])
    const realTypesByName = new Map([
      ['post', 'Post'],
      ['author', 'Author'],
    ])
    expect(findReferencedTypes(schema, realTypesByName, 'post')).toEqual(['Author'])
  })

  it('returns an empty array for a type with no reference fields', () => {
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]}])
    const realTypesByName = new Map([['post', 'Post']])
    expect(findReferencedTypes(schema, realTypesByName, 'post')).toEqual([])
  })
})

describe('strideSample', () => {
  it('returns items unchanged when there are already sampleSize or fewer', () => {
    expect(strideSample(['a', 'b'], 5)).toEqual(['a', 'b'])
    expect(strideSample(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c'])
  })

  it('spreads sampleSize picks evenly across a larger window, in order', () => {
    const window = Array.from({length: 10}, (_, i) => String.fromCharCode(97 + i)) // a..j
    expect(strideSample(window, 5)).toEqual(['a', 'c', 'e', 'g', 'i'])
  })

  it('never returns more than sampleSize items even for an uneven window size', () => {
    const window = Array.from({length: 97}, (_, i) => i)
    expect(strideSample(window, 5)).toHaveLength(5)
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
      {type: 'caseStudy', title: 'Case study', count: 0, samples: [], referencesTypes: []},
      {type: 'post', title: 'Post', count: 3, samples: ['Post A', 'Post B', 'Post C'], referencesTypes: []},
    ])
  })

  it('drops blank/null sample values rather than passing them through', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]}])
    const fetch = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(['Real title', '', null])

    await expect(surveyContentTypes({fetch}, schema)).resolves.toEqual([
      {type: 'post', title: 'Post', count: 2, samples: ['Real title'], referencesTypes: []},
    ])
  })

  it('stride-samples across the survey window instead of taking only the first SAMPLES_PER_TYPE', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]}])
    const window = Array.from({length: 10}, (_, i) => `Post ${i}`)
    const fetch = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(window)

    const [summary] = await surveyContentTypes({fetch}, schema)
    expect(summary.samples).toEqual(['Post 0', 'Post 2', 'Post 4', 'Post 6', 'Post 8'])
    // second call is the sample query — its own `limit` param carries the survey window size, not SAMPLES_PER_TYPE
    expect(fetch.mock.calls[1][1]).toEqual({type: 'post', limit: 10})
  })

  it('caps the sample window at SAMPLE_WINDOW_SIZE even when a type has far more documents', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]}])
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(Array.from({length: 100}, (_, i) => `Post ${i}`))

    await surveyContentTypes({fetch}, schema)
    expect(fetch.mock.calls[1][1]).toEqual({type: 'post', limit: 100})
  })

  it('carries a type\'s own schema description when one is authored', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post', description: 'SEO-optimized long-form content'}])
    const fetch = vi.fn().mockResolvedValueOnce(0)

    const [summary] = await surveyContentTypes({fetch}, schema)
    expect(summary.description).toBe('SEO-optimized long-form content')
  })

  it('leaves description undefined, not an empty string, when none is authored', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post'}])
    const fetch = vi.fn().mockResolvedValueOnce(0)

    const [summary] = await surveyContentTypes({fetch}, schema)
    expect(summary.description).toBeUndefined()
  })

  it('skips sampling a hostile field name rather than interpolating it into the query', async () => {
    const schema = schemaWith([
      {name: 'post', title: 'Post', fields: [{name: 'bad}name', type: {jsonType: 'string'}}]},
    ])
    // Only the `count()` call is ever expected — a rejected field name must
    // never reach the sample fetch at all, so there is nothing for a second
    // `mockResolvedValueOnce` to satisfy.
    const fetch = vi.fn().mockResolvedValueOnce(3)

    const [summary] = await surveyContentTypes({fetch}, schema)
    expect(summary.samples).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const call of fetch.mock.calls) {
      expect(String(call[0])).not.toContain('bad}name')
    }
  })

  it('still samples a normal field name at this same call site (happy path unchanged)', async () => {
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'title', type: {jsonType: 'string'}}]}])
    const fetch = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(['Post A', 'Post B'])

    const [summary] = await surveyContentTypes({fetch}, schema)
    expect(summary.samples).toEqual(['Post A', 'Post B'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('short-circuits before any field lookup when count is 0', async () => {
    // A field name that would fail SIMPLE_FIELD_PATH if `findSampleFieldName`
    // ever ran on it — proving the `count > 0` guard above short-circuits
    // before that lookup, not merely that its result later goes unused.
    const schema = schemaWith([{name: 'post', title: 'Post', fields: [{name: 'bad}name', type: {jsonType: 'string'}}]}])
    const fetch = vi.fn().mockResolvedValueOnce(0)

    const [summary] = await surveyContentTypes({fetch}, schema)

    expect(summary.samples).toEqual([])
    // Only the `count()` call — a second fetch would mean a sample query ran.
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('formatContentGapsDigest', () => {
  it('formats one line per type, samples inlined', () => {
    const summaries: ContentTypeSummary[] = [
      {type: 'post', title: 'Post', count: 2, samples: ['Hello world', 'Second post'], referencesTypes: []},
      {type: 'caseStudy', title: 'Case study', count: 0, samples: [], referencesTypes: []},
    ]
    expect(formatContentGapsDigest(summaries)).toBe(
      '- Post (2 documents): Hello world | Second post\n- Case study (0 documents)',
    )
  })

  it('uses singular "document" for a count of exactly one', () => {
    expect(
      formatContentGapsDigest([{type: 'post', title: 'Post', count: 1, samples: [], referencesTypes: []}]),
    ).toBe('- Post (1 document)')
  })

  it('includes both description and referencesTypes when present', () => {
    const summaries: ContentTypeSummary[] = [
      {
        type: 'post',
        title: 'Post',
        count: 2,
        samples: ['Hello world'],
        description: 'SEO-optimized long-form content',
        referencesTypes: ['Author', 'Category'],
      },
    ]
    expect(formatContentGapsDigest(summaries)).toBe(
      '- Post (2 documents) — SEO-optimized long-form content (references: Author, Category): Hello world',
    )
  })

  it('is a no-op for a summary with neither description nor referencesTypes (regression)', () => {
    const summaries: ContentTypeSummary[] = [
      {type: 'post', title: 'Post', count: 2, samples: ['Hello world'], referencesTypes: []},
    ]
    expect(formatContentGapsDigest(summaries)).toBe('- Post (2 documents): Hello world')
  })
})
