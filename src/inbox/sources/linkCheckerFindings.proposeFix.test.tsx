import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {type BrokenLink, type BrokenReference, type ScanResult} from 'sanity-plugin-link-checker/core'
import {Subject} from 'rxjs'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {linkCheckerFindings} from './linkCheckerFindings'

/**
 * `instantOnly` on the second `proposeFix` implementor.
 *
 * `linkCheckerFindings.test.ts` (plan 064) already covers the pure mapping
 * (`toItems`/`groupOccurrences`) and one reference-retargeting integration
 * test (never patches an invented id). This file complements that — it
 * never repeats the invented-id assertion — and instead covers the bound
 * `assetIssues.proposeFix.test.tsx` already proves for its own source: a
 * bulk `instantOnly` click must never spend an Agent Actions call, while an
 * explicit single click still may.
 */

const {useClientMock, stableSchema} = vi.hoisted(() => ({
  useClientMock: vi.fn(),
  // A single stable reference — a fresh object per call would recompute
  // every memo keyed on `schema` on each render, same reasoning
  // `assetIssues.proposeFix.test.tsx`'s own `stableSchema` states.
  stableSchema: {
    getTypeNames: () => ['post'],
    get: (name: string) =>
      name === 'post'
        ? {
            title: 'Post',
            fields: [
              {name: 'author', type: {to: [{name: 'author'}]}},
              {name: 'blurb', type: {jsonType: 'string'}},
            ],
          }
        : undefined,
  },
}))

// Same reasoning as `assetIssues.proposeFix.test.tsx`'s own mock: assignment
// reaches Sanity's own `useUserListWithPermissions`, which needs a real
// Studio `source` context this test has no business standing up — none of
// these assertions are about assignment.
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
    fieldPath: 'blurb',
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

function stubClient(options: {
  report: ScanResult
  /** What `*[_id == $id][0].<field>` (the link-fix re-read) resolves to. */
  fieldValue?: string | null
  /** Candidates the reference-retargeting fetch hands back. */
  candidates?: {_id: string; label?: string}[]
  /** What `agent.action.prompt` resolves (or rejects) with. */
  agentAnswer?: string
  agentRejects?: Error
}) {
  const commit = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({commit}))
  const patch = vi.fn(() => ({set}))
  const prompt = options.agentRejects
    ? vi.fn().mockRejectedValue(options.agentRejects)
    : vi.fn().mockResolvedValue(options.agentAnswer ?? '{"id": null}')

  const fetch = vi.fn(async (query: string) => {
    // `observeReport`'s own `readReport` query.
    if (query.includes('ranAt, findings')) return options.report
    // The reference-retargeting candidates fetch.
    if (query.includes('[0...20]')) return options.candidates ?? []
    // The link-fix re-read of the one field.
    if (query.startsWith('*[_id == $id][0].')) return options.fieldValue ?? null
    return null
  })

  const client = {
    config: () => ({dataset: 'production'}),
    fetch,
    observable: {fetch: vi.fn()},
    listen: vi.fn(() => new Subject()),
    patch,
    agent: {action: {prompt}},
    withConfig: () => client,
  } as unknown as SanityClient

  return {client, fetch, patch, set, commit, prompt}
}

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
})

async function renderSource(stub: ReturnType<typeof stubClient>) {
  useClientMock.mockReturnValue(stub.client)

  const source = linkCheckerFindings()
  const {result} = renderHook(() => source.useItems())
  await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
  return result
}

describe('linkCheckerFindings proposeFix — instantOnly', () => {
  it('still fixes a link finding under instantOnly — the free path costs nothing and stays available', async () => {
    const finding = brokenLink()
    const stub = stubClient({
      report: report([finding]),
      fieldValue: 'See https://example.com/dead for details',
    })

    const result = await renderSource(stub)
    const item = result.current.items[0]
    expect(item.quickFixable).toBe(true)

    const proposal = await result.current.proposeFix!(item, {instantOnly: true})
    expect(proposal).not.toBeNull()
    expect(stub.prompt).not.toHaveBeenCalled()

    await proposal!.apply()
    expect(stub.patch).toHaveBeenCalledWith('post-1')
    expect(stub.set).toHaveBeenCalledWith({blurb: 'See for details'})
  })

  it('returns null for a reference finding under instantOnly, and never calls the agent client — the bound a bulk click depends on', async () => {
    const finding = brokenReference()
    const stub = stubClient({
      report: report([finding]),
      candidates: [{_id: 'author-1', label: 'Author One'}],
      agentAnswer: '{"id": "author-1", "label": "Author One", "reason": "best fit"}',
    })

    const result = await renderSource(stub)
    const item = result.current.items[0]
    expect(item.fixable).toBe(true)

    const proposal = await result.current.proposeFix!(item, {instantOnly: true})

    expect(proposal).toBeNull()
    // The assertion that protects against a 200-row bulk click becoming 200
    // billed calls: the agent client itself is never invoked.
    expect(stub.prompt).not.toHaveBeenCalled()
    // Nor is the candidates fetch that would only ever be needed to build
    // the prompt this instantOnly path never sends.
    expect(stub.fetch).not.toHaveBeenCalledWith(expect.stringContaining('[0...20]'), expect.anything())
    expect(stub.patch).not.toHaveBeenCalled()
  })

  it('on an explicit (non-bulk) click, prompts exactly once and apply() patches only the retargeted field', async () => {
    const finding = brokenReference()
    const stub = stubClient({
      report: report([finding]),
      candidates: [
        {_id: 'author-1', label: 'Author One'},
        {_id: 'author-2', label: 'Author Two'},
      ],
      agentAnswer: '{"id": "author-2", "label": "Author Two", "reason": "matches the byline"}',
    })

    const result = await renderSource(stub)
    const item = result.current.items[0]

    const proposal = await result.current.proposeFix!(item)
    expect(proposal?.summary).toBe('Replace with "Author Two" — matches the byline')
    expect(stub.prompt).toHaveBeenCalledTimes(1)

    await proposal!.apply()
    expect(stub.patch).toHaveBeenCalledTimes(1)
    expect(stub.patch).toHaveBeenCalledWith('post-1')
    expect(stub.set).toHaveBeenCalledWith({author: {_type: 'reference', _ref: 'author-2'}})
    expect(stub.commit).toHaveBeenCalledTimes(1)
  })
})
