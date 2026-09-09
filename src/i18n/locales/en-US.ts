/**
 * English is the fallback for every other locale, so it ships eagerly rather
 * than as a lazy import.
 */
const enUS = {
  'inbox.title': 'Inbox',

  'inbox.allClear': 'Nothing waiting on you',
  'inbox.waiting_one': '{{count}} thing waiting on you',
  'inbox.waiting_other': '{{count}} things waiting on you',
  'tab.open': 'Open',
  'tab.done': 'Done',
  'inbox.unconfigured.title': 'Nothing in your inbox yet',
  'inbox.unconfigured.description':
    'Pass sources to structureInbox() to fill this pane — open tasks, upcoming releases, forgotten drafts.',

  'source.empty': 'All clear.',
  'source.noneDone': 'Nothing ticked off yet.',
  'audience.mine': 'Assigned to you',
  'audience.everyone': 'Everyone',
  'source.loading': 'Loading…',
  'source.error.title': 'This section could not load',
  'source.error.retry': 'Try again',

  'item.open': 'Open',

  'selection.select': 'Select',
  'selection.cancel': 'Cancel',
  'selection.count_one': '{{count}} selected',
  'selection.count_other': '{{count}} selected',

  'action.markDone': 'Mark as done',
  'action.markDone.mine': 'Removes it from your inbox. Nothing changes for anyone else.',
  'action.markDone.resolves': 'Completes it for everyone, and removes it from your inbox.',
  'action.markNotDone': 'Mark as not done',
}

export default enUS
