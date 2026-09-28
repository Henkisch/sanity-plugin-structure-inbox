import {describe, expect, it} from 'vitest'

import {ASSIGNEE_UNASSIGNED, matchesInboxFilters, overflowMatchingFilters} from './inboxFilterSentinels'
import {type InboxItem} from './types'

function row(sourceName: string, extra: Partial<InboxItem> = {}): {sourceName: string; item: InboxItem} {
  return {sourceName, item: {id: 'x', title: 'X', ...extra}}
}

describe('matchesInboxFilters', () => {
  it('returns true when both filters are empty', () => {
    expect(matchesInboxFilters(row('drafts'), new Set(), new Set())).toBe(true)
  })

  it('matches when assigneeFilter contains the item assignee id', () => {
    const r = row('drafts', {assignee: {id: 'ada', label: 'Ada'}})
    expect(matchesInboxFilters(r, new Set(['ada']), new Set())).toBe(true)
  })

  it('rejects when assigneeFilter contains a different id', () => {
    const r = row('drafts', {assignee: {id: 'ada', label: 'Ada'}})
    expect(matchesInboxFilters(r, new Set(['grace']), new Set())).toBe(false)
  })

  it('matches ASSIGNEE_UNASSIGNED against an item with no assignee', () => {
    const r = row('drafts')
    expect(matchesInboxFilters(r, new Set([ASSIGNEE_UNASSIGNED]), new Set())).toBe(true)
  })

  it('rejects ASSIGNEE_UNASSIGNED when the item has a real assignee', () => {
    const r = row('drafts', {assignee: {id: 'ada', label: 'Ada'}})
    expect(matchesInboxFilters(r, new Set([ASSIGNEE_UNASSIGNED]), new Set())).toBe(false)
  })

  it('matches when typeFilter contains the row sourceName', () => {
    expect(matchesInboxFilters(row('drafts'), new Set(), new Set(['drafts']))).toBe(true)
  })

  it('rejects when typeFilter does not contain the row sourceName', () => {
    expect(matchesInboxFilters(row('drafts'), new Set(), new Set(['releases']))).toBe(false)
  })

  it('rejects when assignee passes but type fails, with both filters set', () => {
    const r = row('drafts', {assignee: {id: 'ada', label: 'Ada'}})
    expect(matchesInboxFilters(r, new Set(['ada']), new Set(['releases']))).toBe(false)
  })

  it('matches when both filters are set and both pass', () => {
    const r = row('drafts', {assignee: {id: 'ada', label: 'Ada'}})
    expect(matchesInboxFilters(r, new Set(['ada']), new Set(['drafts']))).toBe(true)
  })
})

describe('matchesInboxFilters — language', () => {
  it('ignores language entirely when no language filter is passed', () => {
    expect(matchesInboxFilters(row('drafts', {language: 'sv'}), new Set(), new Set())).toBe(true)
    expect(matchesInboxFilters(row('drafts'), new Set(), new Set(), new Set())).toBe(true)
  })

  it('keeps only rows in a selected language', () => {
    const filter = new Set(['en'])
    expect(matchesInboxFilters(row('drafts', {language: 'en'}), new Set(), new Set(), filter)).toBe(true)
    expect(matchesInboxFilters(row('drafts', {language: 'sv'}), new Set(), new Set(), filter)).toBe(false)
  })

  it('keeps a row with no language visible while a language filter is on', () => {
    // A task or a field-level-localized document isn't one language's
    // version of anything — the filter picks between translations, it
    // doesn't hide language-neutral work.
    expect(matchesInboxFilters(row('drafts'), new Set(), new Set(), new Set(['en']))).toBe(true)
  })
})

describe('overflowMatchingFilters', () => {
  const sources = [
    {sourceName: 'assetIssues', overflow: 40},
    {sourceName: 'drafts', overflow: 3},
    {sourceName: 'todos'},
  ]

  it('adds every source’s overflow with no filter active', () => {
    expect(overflowMatchingFilters(sources, new Set(), new Set())).toBe(43)
  })

  it('follows the type filter exactly, since it is by source', () => {
    expect(overflowMatchingFilters(sources, new Set(), new Set(['drafts']))).toBe(3)
  })

  it('adds nothing while an assignee filter is active', () => {
    expect(overflowMatchingFilters(sources, new Set(['ada']), new Set())).toBe(0)
  })

  it('adds nothing while a language filter is active', () => {
    expect(overflowMatchingFilters(sources, new Set(), new Set(), new Set(['sv']))).toBe(0)
  })

  it('ignores a negative overflow rather than subtracting it', () => {
    expect(overflowMatchingFilters([{sourceName: 'x', overflow: -2}], new Set(), new Set())).toBe(0)
  })
})
