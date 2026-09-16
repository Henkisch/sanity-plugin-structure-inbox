/**
 * English is the fallback for every other locale, so it ships eagerly rather
 * than as a lazy import.
 */
const enUS = {
  'inbox.title': 'Inbox',

  // Leads the headline when the current viewer is known — always the
  // logged-in editor's own first name, never `headlineSubject`'s (that
  // one can name a different teammate the assignee filter picked out).
  'inbox.greeting': 'Hey {{name}}, ',

  // Which "who" the headline names depends on the assignee filter: nobody
  // selected reads as the whole team's queue — which includes the viewer
  // themself, so "you and your team" says so rather than reading like it
  // excludes them — exactly one selected can name that person (or "you"
  // when it's the viewer themself), and anything else (several people, or
  // Unassigned in the mix) has no single clean noun to name, so it says
  // nothing rather than guess.
  'inbox.allClear.team': 'Nothing waiting on you and your team',
  'inbox.allClear.you': 'Nothing waiting on you',
  'inbox.allClear.named': 'Nothing waiting on {{name}}',
  'inbox.allClear.generic': 'Nothing waiting',
  'inbox.waiting.team_one': '{{count}} thing waiting on you and your team',
  'inbox.waiting.team_other': '{{count}} things waiting on you and your team',
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
  // The "+N" overflow chip's own label, once more people are assignable
  // than the avatar stack shows at once.
  'assignee.more_one': '{{count}} more person',
  'assignee.more_other': '{{count}} more people',
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
  'action.snooze.suggested': 'Until {{date}}',

  'action.assign': 'Assign to…',
  'action.assign.suggested': 'Suggest {{name}}',
  'action.assign.reason.lastEditor': 'edited this most recently',
  'action.delete': 'Delete',

  // The main column's own creator control (today, only `todos`) — a plain
  // button when there's exactly one, this menu label only when there's
  // more than one to choose between.
  'inbox.addMenu': 'Add',
  // The pane-wide, source-agnostic "any document type" menu, back beside
  // the tabs — distinct from `inbox.addMenu` above, which is scoped to a
  // source that keeps its own items.
  'inbox.addContent': 'Add content',

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
  'assess.unavailable': 'AI could not read this one.',

  // "Ask the inbox" — see `StructureInboxConfig.ask`'s own doc comment. The
  // only effect a question ever has is a selection; these strings never
  // describe an action being taken on the editor's behalf.
  'ask.placeholder': 'Ask about these items…',
  'ask.submit': 'Ask',
  'ask.loading': 'Looking through your inbox…',
  'ask.nothingMatched': 'Nothing here matches that.',
  'ask.unparseable': 'AI answered, but not in a way I could use.',
  'ask.error': 'Could not reach AI.',
  'ask.dismiss': 'Dismiss',

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

  // The single entry point grouping every pane-level AI read (Summarize,
  // Suggest todos, Find content gaps) behind one trigger — see
  // `Inbox.tsx`'s own `mainColumnActions` doc comment for why these three
  // no longer sit as separate, same-tier buttons.
  'inbox.aiInsightsMenu': 'AI insights',

  // The pane-level counterpart to `assess.*` above — same Agent Actions
  // call, applied to everything currently open instead of one item.
  'summarize.ask': 'Summarize',
  // Shown directly under the menu item's own label — grouped behind one
  // "AI insights" trigger, these three no longer have room to explain
  // themselves the way a standalone toolbar button (with its own tooltip)
  // once did, so the description moves inline instead.
  'summarize.menuHint': 'What looks most worth starting with, across everything open right now.',
  'summarize.loading': 'Summarizing…',
  'summarize.error': 'Could not reach AI.',
  // The result card's own title — same reasoning as `todoSuggest.title`:
  // a bare paragraph next to Dismiss had no context of its own on the card.
  'summarize.title': 'Where to start',
  // Not "Cancel" — nothing is in progress at this point, the read already
  // happened; this closes it, same as dismissing any other read-only card.
  'summarize.dismiss': 'Dismiss',

  // A `main` source's own `action` result (e.g. "Scan for issues") — see
  // `InboxSource.action`'s own doc comment. No dedicated title key: the
  // card titles itself with the action's own `label`, since that's already
  // whatever the source itself calls this action.
  'sourceAction.dismiss': 'Dismiss',
  'sourceAction.error': 'Could not complete.',

  // "Find content gaps" — see `StructureInboxConfig.contentGaps`'s own doc
  // comment for why this is opt-in, unlike every other read in this pane:
  // its output is a judgment call, not a fact.
  'contentGaps.ask': 'Find content gaps',
  // See `summarize.menuHint`'s own doc comment for why this exists.
  'contentGaps.menuHint': "A judgment call on what's missing across the project's own content, not just what's open right now.",
  'contentGaps.loading': 'Reading your content…',
  'contentGaps.title': 'Content gaps',
  'contentGaps.none': 'Nothing looks like a clear gap right now.',
  'contentGaps.error': 'Could not reach AI.',
  'contentGaps.dismiss': 'Dismiss',
  'contentGaps.dismissAll': 'Dismiss all',

  'stats.title': 'Overview',
  // AI-suggested personal todos — a distinct read (concrete todos to add,
  // not a paragraph) with its own trigger next to Summarize's, same
  // "insight, then action" shape `fix.*` uses for a fix proposal: never
  // added on its own, only ever via an explicit `todoSuggest.add` click.
  'todoSuggest.ask': 'Suggest todos',
  // See `summarize.menuHint`'s own doc comment for why this exists.
  'todoSuggest.menuHint': 'AI-suggested personal todos worth adding to your own list.',
  // The result card's own title, once it actually has items — the error/
  // nothing-found states name themselves in their own sentence, but a bare
  // list of suggestions had nothing on its own left edge, next to
  // `dismissAll` on the right.
  'todoSuggest.title': 'Suggested todos',
  'todoSuggest.loading': 'Thinking…',
  'todoSuggest.none': 'Nothing looks worth a new todo right now.',
  'todoSuggest.error': 'Could not reach AI.',
  'todoSuggest.add': 'Add todo',
  'todoSuggest.dismiss': 'Dismiss',
  // The whole-card dismiss, distinct from the per-item one right above it —
  // same word would read as one of them not doing what it says.
  'todoSuggest.dismissAll': 'Dismiss all',
  'stats.load.title': 'Open items by assignee',
  // The three lines `InboxStats.tsx` shows only above `STATS_MIN_ROWS` (or
  // when something wakes soon) — each says something the visible list
  // itself cannot, unlike the now-removed age/assignee breakdowns.
  'stats.oldestOpen': 'Oldest open item',
  'stats.days_one': '{{count}} day',
  'stats.days_other': '{{count}} days',
  'stats.nextWake': 'Next wakes',
  'stats.overdue': 'Overdue',

  // `needsAttention` — off-track releases promoted into the main column.
  // See that source's own doc comment for why each condition gets its own
  // wording rather than one generic "needs attention" label.
  'needsAttention.overdue': 'Scheduled {{when}} — still not published',
  'needsAttention.emptyAndImminent': 'Scheduled {{when}} — nothing in it yet',
  'needsAttention.ageingUndated': 'Still being filled, no date set',
}

export default enUS
