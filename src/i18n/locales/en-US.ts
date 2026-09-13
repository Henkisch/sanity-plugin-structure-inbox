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
  'tab.snoozed': 'Snoozed',
  'inbox.unconfigured.title': 'Nothing in your inbox yet',
  'inbox.unconfigured.description':
    'Pass sources to structureInbox() to fill this pane — open tasks, upcoming releases, forgotten drafts.',

  'source.empty': 'All clear.',
  'source.noneDone': 'Nothing ticked off yet.',
  'source.noneSnoozed': 'Nothing snoozed.',
  'audience.mine': 'Assigned to you',
  'audience.everyone': 'Everyone',
  'assignee.unassigned': 'Unassigned',
  'assignee.unassign': 'Unassign',
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
  'undo.snoozed_one': '{{count}} snoozed',
  'undo.snoozed_other': '{{count}} snoozed',
  'undo.assigned_one': '{{count}} assigned to {{name}}',
  'undo.assigned_other': '{{count}} assigned to {{name}}',
  'undo.unassigned': 'Unassigned',
  'undo.done': 'Undone',

  'action.markDone': 'Mark as done',
  'action.markDone.mine': 'Removes it from your inbox. Nothing changes for anyone else.',
  'action.markDone.resolves': 'Completes it for everyone, and removes it from your inbox.',
  'action.markNotDone': 'Mark as not done',
  'action.wakeNow': 'Wake now',

  'action.snooze': 'Snooze',
  'action.snooze.laterToday': 'Later today',
  'action.snooze.tomorrow': 'Tomorrow',
  'action.snooze.nextWeek': 'Next week',

  'action.assign': 'Assign to…',
  'action.delete': 'Delete',

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
}

export default enUS
