/**
 * English is the fallback for every other locale, so it ships eagerly rather
 * than as a lazy import.
 */
const enUS = {
  'home.title': 'Home',

  'inbox.description': 'Things waiting on you.',
  'inbox.showDone': 'Show done',
  'inbox.hideDone': 'Hide done',
  'inbox.unconfigured.title': 'Nothing in your inbox yet',
  'inbox.unconfigured.description':
    'Pass sources to structureHome() to fill this pane — open tasks, upcoming releases, forgotten drafts.',

  'source.empty': 'All clear.',
  'source.loading': 'Loading…',
  'source.error.title': 'This section could not load',
  'source.error.retry': 'Try again',

  'item.open': 'Open',
  'item.resolve': 'Mark as done',
  'item.dismiss': 'Dismiss from your inbox',
}

export default enUS
