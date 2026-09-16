import {describe, expect, it} from 'vitest'

import {findAltEligibleImageFields, formatAssetSize} from './assetIssues'

/**
 * Minimal fixture schema types, shaped exactly the way `@sanity/types`'
 * own `isDocumentSchemaType`/`isImageSchemaType` guards actually check at
 * runtime (confirmed by reading their compiled source): a document type
 * chains `.type` up to something named `"document"`; an image type (or
 * anything built on one) is just anything named `"image"` somewhere in
 * that same chain. Not the full real schema shape — only what those two
 * guards, and this module's own field walk, ever read.
 */
interface FixtureType {
  name: string
  title?: string
  jsonType?: string
  type?: FixtureType
  fields?: {name: string; type: FixtureType}[]
}

const documentType: FixtureType = {name: 'document', jsonType: 'object'}
const stringType: FixtureType = {name: 'string', jsonType: 'string'}

function imageType(fields: {name: string; type: FixtureType}[] = []): FixtureType {
  return {name: 'image', jsonType: 'object', fields}
}

function postType() {
  return {
    name: 'post',
    title: 'Post',
    jsonType: 'object' as const,
    type: documentType,
    fields: [
      {name: 'title', type: stringType},
      {name: 'heroImage', type: imageType([{name: 'alt', type: stringType}])},
    ],
  }
}

describe('findAltEligibleImageFields', () => {
  it('finds a top-level image field that declares the alt sub-field', () => {
    const schema = {getTypeNames: () => ['post'], get: () => postType()}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([
      {documentType: 'post', documentTypeTitle: 'Post', fieldName: 'heroImage', fieldTitle: 'heroImage'},
    ])
  })

  it('skips an image field with no matching alt sub-field', () => {
    const type = {
      name: 'author',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'photo', type: imageType([{name: 'caption', type: stringType}])}],
    }
    const schema = {getTypeNames: () => ['author'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })

  it('skips a document type with no image field at all', () => {
    const type = {name: 'event', jsonType: 'object' as const, type: documentType, fields: [{name: 'title', type: stringType}]}
    const schema = {getTypeNames: () => ['event'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })

  it('skips a non-document object type, even with an eligible image field', () => {
    const type = {
      name: 'seo',
      jsonType: 'object' as const,
      // No `document` anywhere up the `.type` chain.
      fields: [{name: 'ogImage', type: imageType([{name: 'alt', type: stringType}])}],
    }
    const schema = {getTypeNames: () => ['seo'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })

  it("skips Sanity's own hidden/system types", () => {
    const schema = {getTypeNames: () => ['sanity.imageAsset'], get: () => postType()}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })

  it('respects a custom altFieldName', () => {
    const type = {
      name: 'post',
      title: 'Post',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'heroImage', type: imageType([{name: 'description', type: stringType}])}],
    }
    const schema = {getTypeNames: () => ['post'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
    expect(findAltEligibleImageFields(schema, 'description')).toEqual([
      {documentType: 'post', documentTypeTitle: 'Post', fieldName: 'heroImage', fieldTitle: 'heroImage'},
    ])
  })
})

describe('formatAssetSize', () => {
  it('renders sub-kilobyte sizes in bytes', () => {
    expect(formatAssetSize(500)).toBe('500 B')
  })

  it('renders kilobyte-range sizes in KB', () => {
    expect(formatAssetSize(2048)).toBe('2.0 KB')
  })

  it('renders the real oversized test-asset sizes confirmed live in MB', () => {
    // Confirmed live against the test dataset — two AI-generated images, both flagged oversized and unused.
    expect(formatAssetSize(1_055_292)).toBe('1.0 MB')
    expect(formatAssetSize(1_118_783)).toBe('1.1 MB')
  })
})
