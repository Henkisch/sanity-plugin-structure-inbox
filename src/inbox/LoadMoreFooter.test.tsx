import {describe, expect, it, vi} from 'vitest'

import {summarizeMore} from './LoadMoreFooter'
import {type SourceReport} from './SourceFeed'

function report(name: string, overrides: Partial<SourceReport> = {}): SourceReport {
  return {source: {name, title: name, useItems: () => ({items: []})}, open: [], cleared: [], snoozed: [], ...overrides}
}

const none = new Set<string>()

describe('summarizeMore', () => {
  const reports = {
    assets: report('assets', {overflow: 40, loadMore: vi.fn()}),
    drafts: report('drafts', {overflow: 3}),
    todos: report('todos'),
  }
  const order = ['assets', 'drafts', 'todos']

  it('adds up every source’s overflow, and loads from those that still can', () => {
    const summary = summarizeMore(reports, order, none, none, none)
    expect(summary.hidden).toBe(43)
    expect(summary.countKnown).toBe(true)
    expect(summary.loaders.map((r) => r.source.name)).toEqual(['assets'])
  })

  it('follows the type filter exactly, since it is by source', () => {
    const summary = summarizeMore(reports, order, none, new Set(['drafts']), none)
    expect(summary.hidden).toBe(3)
    expect(summary.loaders).toEqual([])
  })

  it('still offers more under an assignee or language filter, but cannot say how many', () => {
    expect(summarizeMore(reports, order, new Set(['ada']), none, none).countKnown).toBe(false)
    expect(summarizeMore(reports, order, none, none, new Set(['sv'])).countKnown).toBe(false)
    expect(summarizeMore(reports, order, new Set(['ada']), none, none).loaders).toHaveLength(1)
  })

  it('reports a page on its way from any shown source', () => {
    const loading = {...reports, drafts: report('drafts', {overflow: 3, loadingMore: true})}
    expect(summarizeMore(loading, order, none, none, none).loadingMore).toBe(true)
  })
})
