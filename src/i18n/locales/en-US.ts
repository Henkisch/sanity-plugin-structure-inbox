/**
 * English is the fallback for every other locale, so it ships eagerly rather
 * than as a lazy import.
 */
const enUS = {
  'inbox.title': 'Inbox',

  'inbox.description': 'Everything waiting on you, in one place.',
  'inbox.allClear': 'Nothing waiting on you',
  'inbox.waiting_one': '{{count}} thing waiting on you',
  'inbox.waiting_other': '{{count}} things waiting on you',
  'inbox.showDone': 'Show done',
  'inbox.hideDone': 'Hide done',
  'inbox.unconfigured.title': 'Nothing in your inbox yet',
  'inbox.unconfigured.description':
    'Pass sources to structureInbox() to fill this pane — open tasks, upcoming releases, forgotten drafts.',

  'source.empty': 'All clear.',
  'source.loading': 'Loading…',
  'source.error.title': 'This section could not load',
  'source.error.retry': 'Try again',

  'item.open': 'Open',

  'selection.select': 'Select',
  'selection.clear': 'Clear',
  'selection.count_one': '{{count}} selected',
  'selection.count_other': '{{count}} selected',

  'action.markDone': 'Mark as done',
  'action.dismiss': 'Dismiss',
  'action.restore': 'Put back',
}

export default enUS
