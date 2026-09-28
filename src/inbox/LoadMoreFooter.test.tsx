import {describe, expect, it, vi} from 'vitest'

import {summarizeMore} from './LoadMoreFooter'
import {MAX_LOADED_ROWS, PAGE_SIZE, SHOW_ALL_THRESHOLD} from './sources/pagedLimit'
import {type SourceReport} from './SourceFeed'
import {type InboxItem} from './types'

function rows(count: number): InboxItem[] {
  return Array.from({length: count}, (_, i) => ({id: `r${i}`, title: `Row ${i}`}))
}

function report(name: string, overrides: Partial<SourceReport> = {}): SourceReport {
  return {source: {name, title: name, useItems: () => ({items: []})}, open: [], cleared: [], snoozed: [], ...overrides}
}

const none = new Set<string>()

describe('summarizeMore', () => {
  it('offers everything at once when the rest is short', () => {
    const reports = {
      assets: report('assets', {open: rows(19), overflow: 44, loadMore: vi.fn()}),
      drafts: report('drafts', {open: rows(3), overflow: 3, loadMore: vi.fn()}),
    }
    const summary = summarizeMore(reports, ['assets', 'drafts'], none, none, none)
    expect(summary.hidden).toBe(47)
    expect(summary.showAll).toBe(true)
    expect(summary.step).toBe(47)
    expect(summary.plan.map(({report: r, count}) => [r.source.name, count])).toEqual([
      ['assets', 44],
      ['drafts', 3],
    ])
  })

  it('pages a long tail by one list-wide step, split by what each source has left', () => {
    const reports = {
      assets: report('assets', {open: rows(20), overflow: 400, loadMore: vi.fn()}),
      tasks: report('tasks', {open: rows(10), overflow: 100, loadMore: vi.fn()}),
    }
    const summary = summarizeMore(reports, ['assets', 'tasks'], none, none, none)
    expect(summary.showAll).toBe(false)
    expect(summary.step).toBe(PAGE_SIZE)
    expect(summary.plan.map(({count}) => count)).toEqual([40, 10])
  })

  it('says "all" only when every hidden item is loadable', () => {
    const reports = {
      assets: report('assets', {overflow: 10, loadMore: vi.fn()}),
      stuck: report('stuck', {overflow: 5}),
    }
    const summary = summarizeMore(reports, ['assets', 'stuck'], none, none, none)
    expect(summary.showAll).toBe(false)
    expect(summary.step).toBe(10)
  })

  it('never takes the whole list past the row budget', () => {
    const reports = {
      assets: report('assets', {open: rows(MAX_LOADED_ROWS - 12), overflow: 80, loadMore: vi.fn()}),
      tasks: report('tasks', {open: rows(2), overflow: 20, loadMore: vi.fn()}),
    }
    const summary = summarizeMore(reports, ['assets', 'tasks'], none, none, none)
    expect(summary.step).toBe(10)
    expect(summary.showAll).toBe(false)
  })

  it('stops offering, and says why, once the budget is spent', () => {
    const reports = {assets: report('assets', {open: rows(MAX_LOADED_ROWS), overflow: 80, loadMore: vi.fn()})}
    const summary = summarizeMore(reports, ['assets'], none, none, none)
    expect(summary.plan).toEqual([])
    expect(summary.atLimit).toBe(true)
  })

  it('follows the type filter exactly, since it is by source', () => {
    const reports = {
      assets: report('assets', {overflow: 400, loadMore: vi.fn()}),
      drafts: report('drafts', {overflow: 3, loadMore: vi.fn()}),
    }
    const summary = summarizeMore(reports, ['assets', 'drafts'], none, new Set(['drafts']), none)
    expect(summary.hidden).toBe(3)
    expect(summary.plan.map(({report: r}) => r.source.name)).toEqual(['drafts'])
  })

  it('still offers more under an assignee or language filter, but cannot say how many match', () => {
    const reports = {assets: report('assets', {overflow: 40, loadMore: vi.fn()})}
    expect(summarizeMore(reports, ['assets'], new Set(['ada']), none, none).countKnown).toBe(false)
    expect(summarizeMore(reports, ['assets'], none, none, new Set(['sv'])).countKnown).toBe(false)
    expect(summarizeMore(reports, ['assets'], new Set(['ada']), none, none).plan).toHaveLength(1)
  })

  it('reports a page on its way from any shown source', () => {
    const reports = {drafts: report('drafts', {overflow: 3, loadingMore: true})}
    expect(summarizeMore(reports, ['drafts'], none, none, none).loadingMore).toBe(true)
  })

  it('keeps the show-all threshold meaningful', () => {
    expect(SHOW_ALL_THRESHOLD).toBeGreaterThanOrEqual(PAGE_SIZE)
  })
})
