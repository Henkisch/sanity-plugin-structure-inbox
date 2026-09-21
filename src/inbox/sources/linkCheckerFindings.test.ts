import {getFindingKey, type BrokenLink, type BrokenReference, type ScanResult} from 'sanity-plugin-link-checker/core'
import {describe, expect, it} from 'vitest'

import {groupOccurrences, toItems} from './linkCheckerFindings'

function fakeSchema(
  titles: Record<string, string> = {},
  fields: Record<string, {fields: {name: string; type: unknown}[]}> = {},
) {
  return {
    get: (name: string) => {
      if (fields[name]) return {title: titles[name], ...fields[name]}
      return titles[name] ? {title: titles[name]} : undefined
    },
  } as ReturnType<typeof import('sanity').useSchema>
}

/** A schema whose `post` type has a plain top-level reference field, `to` a single type — the one shape `proposeFix` can retarget. */
function schemaWithSingleReference(fieldName: string, toType: string) {
  return fakeSchema(
    {},
    {post: {fields: [{name: fieldName, type: {to: [{name: toType}]}}]}},
  )
}

/** A schema whose `post` type has a plain top-level string/text field — the one shape a broken *link* fix can safely strip a dead URL out of. */
function schemaWithTextField(fieldName: string) {
  return fakeSchema({}, {post: {fields: [{name: fieldName, type: {jsonType: 'string'}}]}})
}

function brokenReference(overrides: Partial<BrokenReference> = {}): BrokenReference {
  return {
    kind: 'reference',
    fromId: 'post-1',
    fromType: 'post',
    fieldPath: 'author',
    refId: 'author-999',
    ...overrides,
  }
}

function brokenLink(overrides: Partial<BrokenLink> = {}): BrokenLink {
  return {
    kind: 'link',
    fromId: 'post-1',
    fromType: 'post',
    fieldPath: 'body[0].markDefs[0].link',
    href: 'https://example.com/dead',
    result: {status: 'broken', httpStatus: 404},
    ...overrides,
  }
}

function report(findings: ScanResult['findings']): ScanResult {
  return {
    ranAt: '2026-06-01T00:00:00.000Z',
    findings,
    documentsScanned: 1,
    urlsChecked: 1,
    source: 'browser',
  }
}

describe('toItems', () => {
  it('returns nothing for a report that has not run yet', () => {
    expect(toItems(null, fakeSchema(), false, 50)).toEqual([])
  })

  it('always includes a broken reference, tagged critical', () => {
    const finding = brokenReference()
    const items = toItems(report([finding]), fakeSchema({post: 'Post'}), false, 50)

    expect(items).toEqual([
      expect.objectContaining({
        id: getFindingKey(finding),
        title: 'Broken reference in author',
        subtitle: 'Post',
        tone: 'critical',
      }),
    ])
  })

  it('includes a confirmed-broken link, tagged critical', () => {
    const finding = brokenLink({result: {status: 'broken', httpStatus: 404}})
    const items = toItems(report([finding]), fakeSchema({post: 'Post'}), false, 50)

    expect(items).toEqual([
      expect.objectContaining({
        id: getFindingKey(finding),
        title: 'https://example.com/dead',
        subtitle: 'Post · body[0].markDefs[0].link',
        tone: 'critical',
      }),
    ])
  })

  it('excludes an unverifiable link by default — noisy without the Document Function', () => {
    const finding = brokenLink({result: {status: 'unverifiable', reason: 'cors'}})
    expect(toItems(report([finding]), fakeSchema(), false, 50)).toEqual([])
  })

  it('includes an unverifiable link when asked, tagged caution not critical', () => {
    const finding = brokenLink({result: {status: 'unverifiable', reason: 'cors'}})
    const items = toItems(report([finding]), fakeSchema(), true, 50)

    expect(items).toEqual([expect.objectContaining({tone: 'caution'})])
  })

  it('never includes an ok link finding, regardless of includeUnverifiable', () => {
    const finding = brokenLink({result: {status: 'ok', httpStatus: 200}})
    expect(toItems(report([finding]), fakeSchema(), true, 50)).toEqual([])
  })

  it('caps the result at limit, after filtering out ok/unverifiable noise', () => {
    const findings = [
      brokenLink({fieldPath: 'a', href: 'https://example.com/1'}),
      brokenLink({fieldPath: 'b', href: 'https://example.com/2', result: {status: 'ok'}}),
      brokenLink({fieldPath: 'c', href: 'https://example.com/3'}),
    ]

    const items = toItems(report(findings), fakeSchema(), false, 1)

    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('https://example.com/1')
  })

  it('falls back to a schema type name when the type has no title', () => {
    const finding = brokenReference({fromType: 'untitledType'})
    const items = toItems(report([finding]), fakeSchema(), false, 50)

    expect(items[0].subtitle).toBe('untitledType')
  })

  it('uses the document’s own last-edit time, falling back to the scan time', () => {
    const edited = brokenReference({docStateUpdatedAt: {draft: '2026-05-01T00:00:00.000Z'}})
    const unedited = brokenReference({fromId: 'post-2', fieldPath: 'author2'})

    const items = toItems(report([edited, unedited]), fakeSchema(), false, 50)

    expect(items[0].changedAt).toBe('2026-05-01T00:00:00.000Z')
    expect(items[1].changedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  describe('fixable', () => {
    it('marks a broken reference fixable when its field is a plain top-level, single-type reference', () => {
      const finding = brokenReference({fieldPath: 'author'})
      const items = toItems(report([finding]), schemaWithSingleReference('author', 'author'), false, 50)

      expect(items[0].fixable).toBe(true)
    })

    it('is not fixable when the field path is nested (not a plain top-level name)', () => {
      const finding = brokenReference({fieldPath: 'body[0].markDefs[0].author'})
      const items = toItems(
        report([finding]),
        schemaWithSingleReference('body[0].markDefs[0].author', 'author'),
        false,
        50,
      )

      expect(items[0].fixable).toBe(false)
    })

    it('is not fixable when the field accepts more than one type', () => {
      const finding = brokenReference({fieldPath: 'author'})
      const schema = fakeSchema(
        {},
        {post: {fields: [{name: 'author', type: {to: [{name: 'author'}, {name: 'organization'}]}}]}},
      )

      expect(toItems(report([finding]), schema, false, 50)[0].fixable).toBe(false)
    })

    it('is not fixable when the schema has no matching field at all', () => {
      const finding = brokenReference({fieldPath: 'author'})
      const items = toItems(report([finding]), fakeSchema({post: 'Post'}), false, 50)

      expect(items[0].fixable).toBe(false)
    })

    it('is not fixable for a broken link with a nested (Portable Text) field path — no safe patch path for that shape yet', () => {
      const finding = brokenLink() // default fieldPath: 'body[0].markDefs[0].link'
      const items = toItems(report([finding]), schemaWithTextField('link'), false, 50)

      expect(items[0].fixable).toBe(false)
    })

    it('marks a confirmed-broken link fixable when its field is a plain top-level string/text field', () => {
      const finding = brokenLink({fieldPath: 'body', result: {status: 'broken', httpStatus: 404}})
      const items = toItems(report([finding]), schemaWithTextField('body'), false, 50)

      expect(items[0].fixable).toBe(true)
    })

    it('is not fixable for a merely unverifiable link, even in an otherwise-eligible field — nothing confirmed dead to remove', () => {
      const finding = brokenLink({fieldPath: 'body', result: {status: 'unverifiable', reason: 'cors'}})
      const items = toItems(report([finding]), schemaWithTextField('body'), true, 50)

      expect(items[0].fixable).toBe(false)
    })

    it('is not fixable for a broken link whose field is not a string/text type', () => {
      const finding = brokenLink({fieldPath: 'author'})
      const items = toItems(report([finding]), schemaWithSingleReference('author', 'author'), false, 50)

      expect(items[0].fixable).toBe(false)
    })
  })
})

describe('grouping the several findings one dead link produces', () => {
  it('collapses the same URL in one document into a single row, and counts the rest', () => {
    // The real shape from the scanner: a `customLink` annotation stores the
    // same URL under both `external` and `href`, so one broken link arrives
    // as two findings differing only in the last path segment.
    const items = toItems(
      report([
        brokenLink({fieldPath: 'richText[2].markDefs[0].customLink.external'}),
        brokenLink({fieldPath: 'richText[2].markDefs[0].customLink.href'}),
      ]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items).toHaveLength(1)
    expect(items[0].subtitle).toBe('Post · 2 places')
  })

  it('names the exact field when there is only one of them', () => {
    const items = toItems(
      report([brokenLink({fieldPath: 'richText[2].markDefs[0].customLink.href'})]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items[0].subtitle).toBe('Post · richText[2].markDefs[0].customLink.href')
  })

  it('keeps the same dead URL in two different documents as two rows', () => {
    // Non-vacuous: grouping on href alone would merge these, and they are
    // genuinely two separate pieces of work.
    const items = toItems(
      report([brokenLink({fromId: 'post-1'}), brokenLink({fromId: 'post-2'})]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items).toHaveLength(2)
  })

  it('keeps two different dead URLs in one document as two rows', () => {
    const items = toItems(
      report([
        brokenLink({href: 'https://example.com/a'}),
        brokenLink({href: 'https://example.com/b'}),
      ]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items).toHaveLength(2)
  })

  it('never groups references, even two pointing at the same missing document', () => {
    const items = toItems(
      report([
        brokenReference({fieldPath: 'author'}),
        brokenReference({fieldPath: 'reviewer'}),
      ]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items).toHaveLength(2)
  })

  it('navigates to the first occurrence, so the row still lands on a real field', () => {
    const items = toItems(
      report([
        brokenLink({fieldPath: 'a.external', focusPath: 'a.external'}),
        brokenLink({fieldPath: 'a.href', focusPath: 'a.href'}),
      ]),
      fakeSchema({post: 'Post'}),
      false,
      50,
    )

    expect(items[0].intent?.params.path).toBe('a.external')
  })

  it('does not offer a fix on a grouped row, since fixing one occurrence leaves the others', () => {
    const items = toItems(
      report([
        brokenLink({fieldPath: 'url', href: 'https://example.com/dead'}),
        brokenLink({fieldPath: 'body[0].href', href: 'https://example.com/dead'}),
      ]),
      schemaWithTextField('url'),
      false,
      50,
    )

    expect(items).toHaveLength(1)
    // `url` alone would be fixable — the grouping is what withdraws it.
    expect(items[0].fixable).toBe(false)
    expect(items[0].quickFixable).toBe(false)
  })

  it('applies the row limit after grouping, not before', () => {
    // Otherwise a limit of 2 spends both slots on one link's two occurrences.
    const items = toItems(
      report([
        brokenLink({href: 'https://example.com/a', fieldPath: 'x.external'}),
        brokenLink({href: 'https://example.com/a', fieldPath: 'x.href'}),
        brokenLink({href: 'https://example.com/b', fieldPath: 'y.external'}),
        brokenLink({href: 'https://example.com/b', fieldPath: 'y.href'}),
      ]),
      fakeSchema({post: 'Post'}),
      false,
      2,
    )

    expect(items).toHaveLength(2)
    expect(items.map((i) => i.title)).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('counts occurrences without reordering what survives', () => {
    const grouped = groupOccurrences([
      brokenLink({href: 'https://example.com/a', fieldPath: 'x'}),
      brokenLink({href: 'https://example.com/b', fieldPath: 'y'}),
      brokenLink({href: 'https://example.com/a', fieldPath: 'z'}),
    ])

    expect(grouped.map((g) => [g.finding.fieldPath, g.occurrences])).toEqual([
      ['x', 2],
      ['y', 1],
    ])
  })
})
