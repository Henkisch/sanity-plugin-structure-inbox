import {describe, expect, it} from 'vitest'

import {
  INBOX_ASSIGNEE_PARAM,
  INBOX_TYPE_PARAM,
  INBOX_VIEW_PARAM,
  parseInboxPaneParams,
  serializeInboxPaneParams,
} from './inboxPaneParams'

describe('parseInboxPaneParams', () => {
  it("defaults to today's hardcoded state when the pane has no params at all", () => {
    expect(parseInboxPaneParams(undefined)).toEqual({
      view: 'open',
      assigneeFilter: new Set(),
      typeFilter: new Set(),
    })
    expect(parseInboxPaneParams({})).toEqual({
      view: 'open',
      assigneeFilter: new Set(),
      typeFilter: new Set(),
    })
  })

  it('reads a recognized view and comma-joined filters', () => {
    expect(
      parseInboxPaneParams({
        [INBOX_VIEW_PARAM]: 'snoozed',
        [INBOX_ASSIGNEE_PARAM]: 'ada,__unassigned__',
        [INBOX_TYPE_PARAM]: 'drafts',
      }),
    ).toEqual({
      view: 'snoozed',
      assigneeFilter: new Set(['ada', '__unassigned__']),
      typeFilter: new Set(['drafts']),
    })
  })

  it('falls back to "open" for a stale or hand-edited view value', () => {
    expect(parseInboxPaneParams({[INBOX_VIEW_PARAM]: 'archived'}).view).toBe('open')
  })

  it('decodes a comma or other reserved character inside a filter value', () => {
    const encoded = encodeURIComponent('team,lead')
    expect(parseInboxPaneParams({[INBOX_ASSIGNEE_PARAM]: encoded}).assigneeFilter).toEqual(
      new Set(['team,lead']),
    )
  })
})

describe('serializeInboxPaneParams', () => {
  it('omits every param at its default, keeping the unfiltered URL clean', () => {
    expect(
      serializeInboxPaneParams({view: 'open', assigneeFilter: new Set(), typeFilter: new Set()}),
    ).toEqual({
      [INBOX_VIEW_PARAM]: undefined,
      [INBOX_ASSIGNEE_PARAM]: undefined,
      [INBOX_TYPE_PARAM]: undefined,
    })
  })

  it('round-trips a non-default state back through parseInboxPaneParams', () => {
    const state = {
      view: 'cleared' as const,
      assigneeFilter: new Set(['ada', '__unassigned__']),
      typeFilter: new Set(['drafts', 'todos']),
    }
    expect(parseInboxPaneParams(serializeInboxPaneParams(state))).toEqual(state)
  })

  it('percent-encodes a comma inside a filter value so it round-trips', () => {
    const state = {
      view: 'open' as const,
      assigneeFilter: new Set(['team,lead']),
      typeFilter: new Set<string>(),
    }
    expect(parseInboxPaneParams(serializeInboxPaneParams(state))).toEqual(state)
  })
})
