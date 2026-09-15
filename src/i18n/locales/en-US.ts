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
  'assignee.you': '{{name}} (You)',
  // Appended to the avatar's own tooltip for a source with `assigneeReadOnly`
  // set — see its own doc comment on `InboxSourceResult`.
  'assignee.readOnly': "assigned via Sanity's own Tasks, not editable here",
  'filter.type': 'Type',
  'source.loading': 'Loading…',
  'source.error.title': 'This section could not load',
  'source.error.retry': 'Try again',

  'item.open': 'Open',

  'selection.select': 'Select',
  'selection.selectAll': 'Select all',
  'selection.selectMenu': 'Selection options',
  'selection.all': 'All',
  'selection.none': 'None',
  'row.menu': 'More actions',
  'selection.cancel': 'Cancel',
  'selection.undo': 'Undo',
  'selection.count_one': '{{count}} selected',
  'selection.count_other': '{{count}} selected',

  'undo.markedDone_one': '{{count}} marked as done',
  'undo.markedDone_other': '{{count}} marked as done',
  'undo.markedNotDone_one': '{{count}} marked as not done',
  'undo.markedNotDone_other': '{{count}} marked as not done',
  'undo.cleared_one': '{{count}} cleared',
  'undo.cleared_other': '{{count}} cleared',
  'undo.snoozed_one': '{{count}} snoozed',
  'undo.snoozed_other': '{{count}} snoozed',
  'undo.assigned_one': '{{count}} assigned to {{name}}',
  'undo.assigned_other': '{{count}} assigned to {{name}}',
  'undo.unassigned': 'Unassigned',
  'undo.done': 'Undone',

  'action.markDone': 'Mark as done',
  'action.markDone.resolves': 'Completes it for everyone, and removes it from your inbox.',
  'action.markDone.mixed':
    'Completes what it can right now, and clears the rest — nothing changes in Sanity for those.',
  'action.markNotDone': 'Mark as not done',
  'action.clear': 'Clear',
  'action.clear.hint':
    "Moves it to Cleared. Nothing changes in Sanity — you're calling it done yourself, and it comes back to Open if it changes again.",
  'action.wakeNow': 'Wake now',

  'action.snooze': 'Snooze',

  'action.assign': 'Assign to…',
  'action.delete': 'Delete',

  'inbox.addMenu': 'Add',

  // The Team/Private split within a tab's own row list — see
  // `InboxSource.visibility`'s own doc comment for what decides which a row
  // falls into. Deliberately not the same words as `audience.mine`/
  // `audience.everyone`: those describe a display filter (who this is
  // currently scoped to), this describes a structural fact (who could ever
  // see it at all) — reusing the same copy for both would imply they're the
  // same axis, which they aren't.
  'inbox.section.shared': 'Team',
  'inbox.section.private': 'Only you',

  // The Cleared tab's own axis, orthogonal to Team/Only you above: whether
  // Sanity itself confirmed this is done, or an editor just called it done
  // themselves — see `mergeItems.ts`'s `MergedRow.clearedBy` for why this
  // stays visible rather than the two kinds of "cleared" looking identical.
  'cleared.confirmed': 'Confirmed',
  'cleared.manual': 'Cleared by you',

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

  // The "action" half of "insight, then action" — assess only ever reads;
  // this proposes a real change, so it needs its own Apply/Dismiss rather
  // than assess's single answer line. See `InboxSourceResult.proposeFix`.
  'fix.ask': 'Fix with AI',
  'fix.loading': 'Thinking…',
  'fix.none': "AI couldn't find a good match.",
  'fix.apply': 'Apply',
  'fix.applying': 'Applying…',
  'fix.applied': 'Fixed',
  'fix.dismiss': 'Dismiss',
  'fix.error': 'Could not reach AI.',

  // The pane-level counterpart to `assess.*` above — same Agent Actions
  // call, applied to everything currently open instead of one item.
  'summarize.ask': 'Summarize',
  'summarize.loading': 'Summarizing…',
  'summarize.error': 'Could not reach AI.',
  'summarize.hint': 'Asks AI what looks most worth starting with, across everything open right now.',
  // Not "Cancel" — nothing is in progress at this point, the read already
  // happened; this closes it, same as dismissing any other read-only card.
  'summarize.dismiss': 'Dismiss',

  'stats.title': 'Overview',
  // A pointer to the pane-level "Summarize" action, not a second place the
  // result renders — see `InboxStats.tsx`'s own `onSummarize` doc comment.
  // Names what it's actually asking, not just "Ask AI" — that alone left
  // even someone who knows this plugin well with no idea what the question
  // even was.
  'overview.askAi': 'Ask AI: what to work on first →',
  'stats.age.title': 'Open items by age',
  'stats.age.recent': '{{count}} new',
  'stats.age.week': '{{count}} this week',
  'stats.age.old': '{{count}} older',
  'stats.clearedToday': 'Cleared today',
  'stats.load.title': 'Open items by assignee',
}

export default enUS
