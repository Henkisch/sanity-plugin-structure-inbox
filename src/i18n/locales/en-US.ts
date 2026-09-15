/**
 * English is the fallback for every other locale, so it ships eagerly rather
 * than as a lazy import.
 */
const enUS = {
  'inbox.title': 'Inbox',

  // Which "who" the headline names depends on the assignee filter: nobody
  // selected reads as the whole team's queue, exactly one selected can name
  // that person (or "you" when it's the viewer themself), and anything else
  // (several people, or Unassigned in the mix) has no single clean noun to
  // name, so it says nothing rather than guess.
  'inbox.allClear.team': 'Nothing waiting on your team',
  'inbox.allClear.you': 'Nothing waiting on you',
  'inbox.allClear.named': 'Nothing waiting on {{name}}',
  'inbox.allClear.generic': 'Nothing waiting',
  'inbox.waiting.team_one': '{{count}} thing waiting on your team',
  'inbox.waiting.team_other': '{{count}} things waiting on your team',
  'inbox.waiting.you_one': '{{count}} thing waiting on you',
  'inbox.waiting.you_other': '{{count}} things waiting on you',
  'inbox.waiting.named_one': '{{count}} thing waiting on {{name}}',
  'inbox.waiting.named_other': '{{count}} things waiting on {{name}}',
  'inbox.waiting.generic_one': '{{count}} thing waiting',
  'inbox.waiting.generic_other': '{{count}} things waiting',
  'tab.open': 'Open',
  'tab.cleared': 'Cleared',
  'tab.snoozed': 'Snoozed',
  'inbox.unconfigured.title': 'Nothing in your inbox yet',
  'inbox.unconfigured.description':
    'Pass sources to structureInbox() to fill this pane — open tasks, upcoming releases, forgotten drafts.',

  'source.empty': 'All clear.',
  'source.noneCleared': 'Nothing cleared yet.',
  'source.noneSnoozed': 'Nothing snoozed.',
  'audience.mine': 'Assigned to you',
  'audience.everyone': 'Everyone',
  'assignee.unassigned': 'Unassigned',
  'assignee.unassign': 'Unassign',
  'filter.type': 'Type',
  'source.loading': 'Loading…',
  'source.error.title': 'This section could not load',
  'source.error.retry': 'Try again',

  'item.open': 'Open',

  'selection.select': 'Select',
  'selection.selectAll': 'Select all',
  'selection.cancel': 'Cancel',
  'selection.undo': 'Undo',
  'selection.count_one': '{{count}} selected',
  'selection.count_other': '{{count}} selected',

  'undo.markedDone_one': '{{count}} marked as done',
  'undo.markedDone_other': '{{count}} marked as done',
  'undo.acknowledged_one': '{{count}} acknowledged',
  'undo.acknowledged_other': '{{count}} acknowledged',
  'undo.snoozed_one': '{{count}} snoozed',
  'undo.snoozed_other': '{{count}} snoozed',
  'undo.assigned_one': '{{count}} assigned to {{name}}',
  'undo.assigned_other': '{{count}} assigned to {{name}}',
  'undo.savedToTodos_one': '{{count}} saved to your todos',
  'undo.savedToTodos_other': '{{count}} saved to your todos',
  'undo.unassigned': 'Unassigned',
  'undo.done': 'Undone',

  'action.markDone': 'Mark as done',
  'action.markDone.resolves': 'Completes it for everyone, and removes it from your inbox.',
  'action.markDone.mixed':
    'Completes what it can right now, and marks the rest seen — nothing else changes for those.',
  'action.markNotDone': 'Mark as not done',
  'action.acknowledge': 'Acknowledge',
  'action.acknowledge.hint': 'Marks it seen. Nothing changes in Sanity, and it stays in Open.',
  'action.wakeNow': 'Wake now',

  'action.snooze': 'Snooze',
  'action.snooze.laterToday': 'Later today',
  'action.snooze.tomorrow': 'Tomorrow',
  'action.snooze.nextWeek': 'Next week',

  'action.assign': 'Assign to…',
  'action.saveToTodos': 'Save to todos',
  'action.delete': 'Delete',

  'inbox.addMenu': 'Add',

  'todos.addPlaceholder': 'Add a todo…',
  'todos.addButton': 'Add todo',
  'todos.add': 'Add',
  'todos.editButton': 'Edit todo',
  'todos.save': 'Save',
  'todos.titleLabel': 'Title',
  'todos.descriptionLabel': 'Description',
  'todos.descriptionPlaceholder': 'Any extra detail worth remembering…',
  'todos.dueByLabel': 'Due date',

  'assess.ask': 'Ask AI',
  'assess.loading': 'Asking AI…',
  'assess.error': 'Could not reach AI.',

  'stats.title': 'Overview',
  'stats.age.title': 'Open items by age',
  'stats.age.recent': '{{count}} new',
  'stats.age.week': '{{count}} this week',
  'stats.age.old': '{{count}} older',
  'stats.unassigned': 'Unassigned',
  'stats.clearedToday': 'Cleared today',
  'stats.load.title': 'Open items by assignee',
}

export default enUS
