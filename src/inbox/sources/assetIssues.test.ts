import {describe, expect, it} from 'vitest'

import {
  assetIssues,
  classifyAltText,
  findAltEligibleImageFields,
  formatAssetSize,
  normalizeForComparison,
} from './assetIssues'

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

  it('finds a wrapper-object field (e.g. `imageWithAlt`) with an image sub-field and a sibling alt field', () => {
    const imageWithAltType: FixtureType = {
      name: 'imageWithAlt',
      jsonType: 'object',
      fields: [
        {name: 'image', type: imageType()},
        {name: 'alt', type: stringType},
      ],
    }
    const type = {
      name: 'event',
      title: 'Event',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'coverImage', type: imageWithAltType}],
    }
    const schema = {getTypeNames: () => ['event'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([
      {documentType: 'event', documentTypeTitle: 'Event', fieldName: 'coverImage', fieldTitle: 'coverImage'},
    ])
  })

  it('skips a wrapper-object field with no alt sibling', () => {
    const imageWithoutAltType: FixtureType = {
      name: 'imageWithoutAlt',
      jsonType: 'object',
      fields: [{name: 'image', type: imageType()}],
    }
    const type = {
      name: 'event',
      title: 'Event',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'coverImage', type: imageWithoutAltType}],
    }
    const schema = {getTypeNames: () => ['event'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })

  it("finds a wrapper-object field even when its inner image sub-field isn't named `image`", () => {
    const imageWithAltType: FixtureType = {
      name: 'imageWithAlt',
      jsonType: 'object',
      fields: [
        {name: 'asset', type: imageType()},
        {name: 'alt', type: stringType},
      ],
    }
    const type = {
      name: 'event',
      title: 'Event',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'coverImage', type: imageWithAltType}],
    }
    const schema = {getTypeNames: () => ['event'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([
      {documentType: 'event', documentTypeTitle: 'Event', fieldName: 'coverImage', fieldTitle: 'coverImage'},
    ])
  })

  it('skips a field whose name would not be safe to interpolate into a GROQ query', () => {
    const type = {
      name: 'post',
      title: 'Post',
      jsonType: 'object' as const,
      type: documentType,
      fields: [{name: 'hero-image', type: imageType([{name: 'alt', type: stringType}])}],
    }
    const schema = {getTypeNames: () => ['post'], get: () => type}

    expect(findAltEligibleImageFields(schema, 'alt')).toEqual([])
  })
})

describe('assetIssues', () => {
  it('throws when given a malformed altFieldName', () => {
    expect(() => assetIssues({altFieldName: 'alt.text'})).toThrow('alt.text')
    expect(() => assetIssues({altFieldName: 'alt->text'})).toThrow(
      /altFieldName must be a plain field name/,
    )
  })

  it('does not throw for a normal altFieldName', () => {
    expect(() => assetIssues()).not.toThrow()
    expect(() => assetIssues({altFieldName: 'alt'})).not.toThrow()
    expect(() => assetIssues({altFieldName: 'description'})).not.toThrow()
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

describe('normalizeForComparison', () => {
  it('lowercases, strips a file extension, and collapses separators to single spaces', () => {
    expect(normalizeForComparison('IMG_2831.jpg')).toBe('img 2831')
    expect(normalizeForComparison('summer-vacation-photo.PNG')).toBe('summer vacation photo')
    expect(normalizeForComparison('  Team   Offsite  ')).toBe('team offsite')
  })

  it('leaves a string with no extension or separators alone, aside from case', () => {
    expect(normalizeForComparison('Photo')).toBe('photo')
  })
})

describe('classifyAltText', () => {
  it('flags alt text that exactly matches the asset filename', () => {
    expect(classifyAltText('IMG_2831.jpg', 'IMG_2831.jpg')).toBe('filenameLike')
  })

  it('flags alt text that matches the filename after normalizing case, extension, and separators', () => {
    expect(classifyAltText('summer vacation photo', 'summer-vacation-photo.png')).toBe('filenameLike')
    expect(classifyAltText('Summer_Vacation_Photo', 'summer-vacation-photo.jpg')).toBe('filenameLike')
  })

  it.each(['image', 'photo', 'picture', 'graphic', 'photograph'])(
    'flags the generic word %s as a placeholder',
    (word) => {
      expect(classifyAltText(word)).toBe('placeholder')
      expect(classifyAltText(word.toUpperCase())).toBe('placeholder')
    },
  )

  it('flags the generic word "img" as too short rather than placeholder — the length check runs first, and "img" is only 3 characters', () => {
    expect(classifyAltText('img')).toBe('tooShort')
  })

  it('flags empty or whitespace-only alt text as too short', () => {
    expect(classifyAltText('')).toBe('tooShort')
    expect(classifyAltText('   ')).toBe('tooShort')
  })

  it('flags alt text under the minimum length as too short', () => {
    expect(classifyAltText('a')).toBe('tooShort')
    expect(classifyAltText('ab')).toBe('tooShort')
    expect(classifyAltText('abc')).toBe('tooShort')
  })

  it('returns null for a real, descriptive alt text', () => {
    expect(classifyAltText('A golden retriever catching a frisbee in a park')).toBeNull()
    expect(classifyAltText('Team offsite in Gothenburg, September 2026', 'IMG_2831.jpg')).toBeNull()
  })
})
