import {describe, expect, it} from 'vitest'

import {ASSIGNEE_UNASSIGNED, matchesInboxFilters} from './inboxFilterSentinels'
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
