import {getFindingKey, type BrokenLink, type BrokenReference, type ScanResult} from 'sanity-plugin-link-checker/core'
import {describe, expect, it} from 'vitest'

import {toItems} from './linkCheckerFindings'

function fakeSchema(titles: Record<string, string> = {}) {
  return {get: (name: string) => (titles[name] ? {title: titles[name]} : undefined)} as ReturnType<
    typeof import('sanity').useSchema
  >
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
})
