import {type InboxView} from '../inbox/types'

/**
 * Namespaced against a sibling pane's own params one day — `view`/`type`
 * alone are generic enough to plausibly collide.
 */
export const INBOX_VIEW_PARAM = 'inboxView'
export const INBOX_ASSIGNEE_PARAM = 'inboxAssignee'
export const INBOX_TYPE_PARAM = 'inboxType'

export interface InboxPaneFilterState {
  view: InboxView
  assigneeFilter: ReadonlySet<string>
  typeFilter: ReadonlySet<string>
}

function isInboxView(value: string): value is InboxView {
  return value === 'open' || value === 'cleared' || value === 'snoozed'
}

function splitParam(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set()
  return new Set(value.split(',').map(decodeURIComponent).filter(Boolean))
}

function joinParam(values: ReadonlySet<string>): string | undefined {
  if (values.size === 0) return undefined
  return [...values].map(encodeURIComponent).join(',')
}

/**
 * Defensive against a stale, hand-edited, or bookmarked URL naming an
 * unrecognized view — falls back to `'open'`, exactly like today's hardcoded
 * default. A pane opened with no params at all (the backward-compat case)
 * produces this same default.
 */
export function parseInboxPaneParams(
  params: Record<string, string | undefined> | undefined,
): InboxPaneFilterState {
  const rawView = params?.[INBOX_VIEW_PARAM]
  return {
    view: rawView && isInboxView(rawView) ? rawView : 'open',
    assigneeFilter: splitParam(params?.[INBOX_ASSIGNEE_PARAM]),
    typeFilter: splitParam(params?.[INBOX_TYPE_PARAM]),
  }
}

/**
 * Omits a param entirely when it's at its default (`'open'`, an empty
 * filter) — keeps the common, unfiltered URL clean rather than spelling out
 * every default on every pane load.
 */
export function serializeInboxPaneParams(
  state: InboxPaneFilterState,
): Record<string, string | undefined> {
  return {
    [INBOX_VIEW_PARAM]: state.view === 'open' ? undefined : state.view,
    [INBOX_ASSIGNEE_PARAM]: joinParam(state.assigneeFilter),
    [INBOX_TYPE_PARAM]: joinParam(state.typeFilter),
  }
}
