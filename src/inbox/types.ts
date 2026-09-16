import {type ComponentType} from 'react'

import {type SnoozeState} from '../store/snoozes'

/**
 * Which slice of the inbox is on screen: the things still to do, the things
 * Sanity itself confirms are actually resolved, or the things put off until
 * later.
 *
 * @public
 */
export type InboxView = 'open' | 'cleared' | 'snoozed'

/**
 * One actionable thing in an editor's inbox.
 *
 * @public
 */
export interface InboxItem {
  /**
   * Stable identifier, unique within its source.
   *
   * Dismissals are stored against this, so it has to survive a refetch — use
   * the underlying document's id, not an array index.
   */
  id: string
  /** The one line an editor reads to decide whether to act. */
  title: string
  /** Context under the title: who, when, which type. */
  subtitle?: string
  /**
   * When this became relevant. Shown as a relative time, and used to order
   * within a group. May be in the future (a due date, a publish date) — this
   * field is for display only and is never used to decide whether an item is
   * still done.
   */
  timestamp?: string
  /**
   * When the underlying thing last changed.
   *
   * Ticking an item records the moment; if the item changes afterwards it
   * returns to the inbox, because the tick said "I have seen this version".
   * Supply it only when the source can report a real modification time —
   * omitting it makes a dismissal permanent until the editor puts the item
   * back, which is the right default for anything whose changes cannot be
   * observed.
   */
  changedAt?: string
  /**
   * True only when the *source itself* fetched this item already resolved
   * and can say so with real, Sanity-confirmed evidence (a task's own
   * `status`, say) — never set from a per-editor dismissal. Absent (or
   * `false`) for every item from a source with no `resolve`: there is
   * nothing this plugin can verify for those, so they are never cleared,
   * only ever open or acknowledged (see `useDismissals`).
   */
  cleared?: boolean
  icon?: ComponentType
  /** Colours the row. Use sparingly — everything urgent means nothing is. */
  tone?: 'default' | 'primary' | 'positive' | 'caution' | 'critical'
  /**
   * Overrides the source's own static title in the row's category segment
   * ("Task · Everyone", "Broken reference · Everyone") — for a source whose
   * items aren't all the same kind of thing, e.g. `linkCheckerFindings`
   * produces both broken-link and broken-reference findings from one
   * source, and a single static `InboxSource.title` can't say the right
   * word for both. Omit when every item from a source is the same kind
   * (the common case) — the source's own title already says it once.
   */
  category?: string
  /**
   * Where clicking the row takes the editor. Omit for an item with nowhere to go.
   *
   * `'release'` is Sanity's own globally-registered intent for opening a
   * release in the Releases tool (`params: {id: <short release id>}`, not a
   * document id) — see `upcomingReleases.ts`, the one built-in source that
   * uses it.
   */
  intent?: {
    type: 'edit' | 'create' | 'release'
    params: {id?: string; type?: string; [key: string]: string | undefined}
  }
  /**
   * Who this item is assigned to, if anyone — rendered as a small avatar
   * rather than restated in text (a Jira-style issue card, not another line
   * of "Assigned to you" next to text that already said so).
   *
   * `id` is the source's own stable user id (never derived from `label`) —
   * grouping or filtering by `label` alone breaks the moment two project
   * members share a display name, which is a real, not hypothetical, case.
   */
  assignee?: {
    id: string
    label: string
    imageUrl?: string
  }
  /**
   * The description an "edit" dialog should prefill, exactly as stored.
   *
   * Only supplied by a source that also offers `update` — `subtitle` is
   * display text a source is free to shape however it likes (a type name, a
   * relative label), which makes it the wrong thing to hand back into a form.
   */
  description?: string
  /**
   * ISO date (`yyyy-mm-dd`) an "edit" dialog should prefill, exactly as
   * stored — unlike `timestamp`, which a source may fall back to a creation
   * time for display and is therefore ambiguous as an actual due date.
   */
  dueBy?: string
  /**
   * Whether `InboxSourceResult.proposeFix` has anything real to try for this
   * particular item — not just whether the source offers `proposeFix` at
   * all. A source decides this per item (a broken reference in a plain
   * top-level field is eligible; one nested inside Portable Text, today, is
   * not — see `linkCheckerFindings.ts`'s own doc comment on why), so the
   * row's own menu can skip offering "Fix with AI" anywhere it would just
   * come back empty, rather than offering it everywhere and explaining
   * afterwards why nothing happened.
   */
  fixable?: boolean
}

/**
 * What the "add one" dialog collects before calling `create`.
 *
 * @public
 */
export interface CreateItemInput {
  title: string
  description?: string
  /** ISO date (`yyyy-mm-dd`) — a due date, not a moment, so no time of day. */
  dueBy?: string
}

/**
 * A reviewable, not-yet-applied fix — see `InboxSourceResult.proposeFix`.
 *
 * @public
 */
export interface FixProposal {
  /** Plain-language description of what `apply` will do, shown before it runs — e.g. `Replace with "Jane Doe"`. */
  summary: string
  /** Runs the actual mutation. Deterministic — by the time this is called, what to write is already decided. */
  apply: () => Promise<void>
}

/**
 * What a source's `assess` hands back.
 *
 * `tone` is the model's own read on how bad the news is, and is deliberately
 * *not* the same thing as `InboxItem.tone`: that one is a fact the source
 * computed (a task past its due date), this one is an opinion about a
 * document's contents. They render in different places so an editor can tell
 * which they are looking at, and `tone` here never affects where the row
 * sorts — the merged list's order stays deterministic and explainable
 * (`mergeItems.ts`), which is the property that makes it worth trusting at a
 * glance.
 *
 * @public
 */
export interface InboxAssessment {
  /** One short, specific sentence. Rendered as-is. */
  message: string
  /** How bad it looks, if the model committed to one. */
  tone?: InboxItem['tone']
}

/**
 * One AI-suggested personal todo — `Inbox.tsx`'s own "Ask AI: what to work
 * on first" trigger, `InboxStats.tsx`'s own rendering of the result. Not
 * part of `InboxSourceResult`: this reads across every open row at once
 * (the same digest `assess`/Summarize build), not one source's own items, so
 * it lives at the pane level rather than per-source.
 *
 * @public
 */
export interface TodoSuggestion {
  title: string
  reason: string
}

/**
 * @public
 */
export type SuggestTodosState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; items: TodoSuggestion[]}
  | {status: 'error'}

/**
 * What a source hands back on each render.
 *
 * @public
 */
export interface InboxSourceResult {
  items: InboxItem[]
  loading?: boolean
  error?: Error
  /**
   * Completes an item where it actually lives — closing a task, publishing a
   * draft.
   *
   * It is returned from the hook rather than declared on the source so it can
   * close over whatever that took: a client from `useClient`, a store, a
   * mutation hook. Omit it when the item has no completion this plugin can
   * perform. Ticking then only removes the item from this editor's own inbox,
   * and the UI says so rather than implying something changed for everyone.
   */
  resolve?: (item: InboxItem) => Promise<void>
  /**
   * Whether "seen but not resolved" means anything for this source's items.
   * Defaults to `true` for any source with no `resolve` — that's the normal
   * case (a draft, a broken link: something external, worth quietly marking
   * as reviewed without pretending it's done). Set explicitly to `false` for
   * a source whose items have no such in-between state to mark — `todos` is
   * the one built-in example: a todo is either still on the list or deleted,
   * there is no external "resolved elsewhere" to await, so acknowledging one
   * would just be a dead click that changes nothing meaningful. When `false`,
   * the confirm/acknowledge control is omitted entirely for this source's
   * rows rather than offered and left to silently do nothing.
   */
  acknowledgable?: boolean
  /**
   * Undoes a real resolution — reopens a closed task, say. Only meaningful
   * for a source that also offers `resolve`: nothing else can ever produce
   * a `cleared` item in the first place (see `InboxItem.cleared`'s own doc
   * comment), so nothing else has anything real to undo. Powers "Mark as
   * not done" in the Cleared view — omitting it there is a real gap, not a
   * safe default: without it, that control has nothing to call and quietly
   * does nothing.
   */
  reopen?: (item: InboxItem) => Promise<void>
  /**
   * Adds a brand-new item to this source's own list.
   *
   * Only a source that keeps its items itself — nothing external creates
   * them — can offer this meaningfully; a feed of drafts or tasks has no
   * business inventing new ones. Present, it puts an inline "add" input above
   * the list, in the open view only.
   */
  create?: (input: CreateItemInput) => Promise<void> | void
  /**
   * A one-line AI read on this item — "looks ready to publish", "still
   * missing a hero image" — via Sanity's Agent Actions. Informational only:
   * it changes nothing about the item, so it renders the same in every view.
   *
   * Optional because it needs a real document to look at; a source with
   * nothing backing its items (`todos`) has nothing to offer here.
   */
  assess?: (item: InboxItem) => Promise<InboxAssessment>
  /**
   * Proposes a concrete, reviewable fix — the "action" half of "insight,
   * then action" that `assess` alone only ever gives the "insight" half of.
   * Unlike `assess`, this can result in a real write, so it is deliberately
   * two-step: this only ever *proposes* one (`FixProposal.apply` is what
   * actually runs it), never writes anything on its own.
   *
   * The one built-in case today (`linkCheckerFindings.ts`) has Agent
   * Actions choose *which* existing document a broken reference should
   * point to — never *how* to write it: the actual mutation this plugin
   * runs is a plain, deterministic patch it fully controls, the same
   * separation of concerns `resolve`/`assign` already draw between "an
   * editor's own click decided this" and "here's the mechanical write that
   * follows." Returns `null` when there is nothing good to propose (no
   * eligible shape, or the model found no confident candidate) — the row
   * should still only ever offer this when `InboxItem.fixable` is true, so
   * a `null` here is the rarer "even though this looked fixable, nothing
   * good turned up" case, not the common path.
   */
  proposeFix?: (item: InboxItem) => Promise<FixProposal | null>
  /**
   * Delegates an item to someone else — "who's taking this," not just "who
   * owns this": a row needs no single natural owner to be worth assigning
   * (a release, a stray asset), the same way a Jira- or Notion-style task
   * board assigns work regardless of whether the underlying thing has one.
   *
   * Written through one shared, plain, unregistered document
   * (`assignmentStore.ts`'s `ASSIGNMENT_TYPE`) mapping a target id to an
   * assignee id — deliberately not a real Sanity Task: an earlier version
   * of this created one `tasks.task` per assignment, which surfaced as a
   * second, unrelated "Follow up: …" row, needed the addon dataset for a
   * feature that has nothing to do with Tasks, and didn't reliably reuse
   * the same task on reassignment (see `assignmentStore.ts`'s own doc
   * comment for the full history).
   *
   * `users` is who it can go to; `toUser` does the assigning. Bundled
   * together, rather than a bare function, because the list of people to
   * offer is the source's own concern — it knows which dataset (and which
   * permission) makes someone a sensible assignee — not something the
   * generic selection bar should have an opinion on.
   *
   * Optional: only two built-in sources omit it, both for a real structural
   * reason rather than policy — `openTasks` already has a native, real
   * assignee field of its own (`assigneeReadOnly`, a second path here would
   * be redundant), and `todos` lives in the acting editor's own private
   * storage with no shared copy anywhere to label (see `transfer` instead).
   */
  assign?: {
    users: {id: string; label: string}[]
    toUser: (item: InboxItem, userId: string) => Promise<void>
    /**
     * Clears an item's assignee, leaving it open but unowned — distinct from
     * handing it to someone else, and from `remove`, which the item itself
     * doesn't survive. Optional: omit to not offer "Unassign" in the picker
     * at all, for a source where that would never make sense.
     */
    unassign?: (item: InboxItem) => Promise<void>
    /**
     * Who most likely ought to get this, with the evidence for saying so —
     * for `unpublishedDrafts`, whoever last edited the draft, read from the
     * transaction log rather than guessed.
     *
     * A suggestion, never a default: the picker still requires a choice.
     * "Whoever wrote it" is a good guess, not a rule — sometimes the author
     * is exactly the person who should not be chased about it.
     *
     * `reason` is a key, not English text: the source knows *why* (the fact
     * it read), the UI knows *how to say it* in the editor's own language.
     * `'lastEditor'` (whoever last touched the document) and `'mentioned'`
     * (whoever an `@mention` named, `unresolvedComments`' own suggestion)
     * exist today; a future reason should extend this union rather than
     * fall back to a free-text string, so every reason this plugin can
     * ever show stays translatable the same way.
     *
     * Returns `null` when there is no defensible suggestion, including when
     * the obvious candidate is no longer assignable.
     */
    suggestAssignee?: (
      item: InboxItem,
    ) => Promise<{userId: string; reason: 'lastEditor' | 'mentioned'} | null>
  }
  /**
   * True for a source whose items have a real, native assignee — just not
   * one this plugin should offer to change. `openTasks` is the one built-in
   * example: a `tasks.task` already has exactly one real assignee field,
   * natively editable in Sanity's own Tasks UI, so `assign` here would just
   * be a second, redundant path to the same field (see `openTasks.ts`'s own
   * doc comment) — but the assignee itself is still real information worth
   * showing, including "nobody yet."
   *
   * Without this, the row has no way to tell "no assignee concept at all"
   * (`todos` — never assignable to begin with, nothing to show even when
   * empty) apart from "has one, just read-only here" (`openTasks`) once an
   * item happens to be unassigned: both look identical (`item.assignee`
   * absent, no `assign`). Set, it keeps the avatar (or the "Unassigned"
   * placeholder) visible either way, just non-interactive — a disabled
   * cursor and a tooltip saying why, rather than either a dead click or the
   * avatar disappearing entirely depending on whether anyone happens to be
   * assigned at the moment.
   */
  assigneeReadOnly?: boolean
  /**
   * Proposes when this item will next be worth looking at, read out of the
   * thing itself — a draft about an event in March is not worth seeing again
   * next Tuesday.
   *
   * Proposed, never applied: the editor picks it from the snooze control the
   * same way they pick "tomorrow". Returns `null` when the item says nothing
   * about timing, which is the common case and not an error.
   *
   * Optional, and per-source rather than plugin-level (unlike snoozing
   * itself) because answering needs a real document to read: a `todos` item
   * has none, and `upcomingReleases` already knows its own date.
   */
  suggestSnooze?: (item: InboxItem) => Promise<{until: string; reason?: string} | null>
  /**
   * Deletes an item for good — unlike marking it done, which only removes it
   * from this editor's own inbox while leaving it wherever it actually
   * lives. Optional: only a source that keeps its own items, with nowhere
   * else preserving a record of them, has a reason to offer this — `todos`
   * does, so a finished one doesn't just sit dismissed forever.
   */
  remove?: (item: InboxItem) => Promise<void> | void
  /**
   * Changes an item's own title/description/due date in place.
   *
   * Only a source with nowhere else for that editing to happen offers this —
   * `todos` has no document a click could open instead. Present, a row with
   * no `intent` opens the same dialog `create` uses, pre-filled, instead of
   * doing nothing when clicked.
   */
  update?: (item: InboxItem, input: CreateItemInput) => Promise<void> | void
  /**
   * Opens an item somewhere else entirely, for a row with no document
   * `intent` *and* no `update` dialog to fall back to either — the one
   * built-in case is `openTasks.ts`, for a task with no target document:
   * clicking it opens the task's own detail panel (Sanity's own Tasks UI)
   * instead of doing nothing. A row only ever does one of `intent`/`update`/
   * `openDetail` on click, tried in that order.
   */
  openDetail?: (item: InboxItem) => void
  /**
   * A single, source-level action unrelated to any one item — "Scan for
   * broken links", say.
   *
   * An `aside` source renders this as a small button in its own header
   * (`InboxSection.tsx`). A `main` source has no header of its own — every
   * `main` source's items merge into one list (`MergedList`) — so this
   * renders inside that merged list's own header instead (`Inbox.tsx`
   * builds it, `MergedList`'s `actions` prop renders it), alongside
   * Summarize/Suggest todos/Add todo — every other control scoped to just
   * that column.
   *
   * Optional: most sources have nothing like this — their items already
   * come from something else that keeps itself up to date (a live query),
   * with no separate "go do the underlying work now" step to trigger.
   */
  action?: {
    label: string
    /**
     * An optional one-line result, shown in a dismissible card the same way
     * `summarize.ask`/`todoSuggest.ask`'s own results are — a scan (or any
     * other action) that ran silently gave an editor no way to tell it
     * actually did anything beyond the button's own pending state. Return
     * nothing when there's genuinely nothing worth reporting.
     */
    run: () => Promise<string | void>
    /** Shown on the button while `run`'s promise is pending. Defaults to `label`. */
    pendingLabel?: string
    /**
     * Explains what the action actually does, shown as a tooltip on hover —
     * the button's own label ("Scan for issues") names it, not what it
     * covers. Omit for an action self-explanatory from its label alone.
     */
    description?: string
    /** Shown on the button before the label. Omit for a plain text button. */
    icon?: ComponentType
  }
}

/**
 * A feed of inbox items — open tasks, upcoming releases, drafts left unpublished.
 *
 * @public
 */
export interface InboxSource {
  /** Stable identifier. Namespaces this source's dismissals. */
  name: string
  /** Group heading in the inbox. */
  title: string
  icon?: ComponentType

  /**
   * Which column this source belongs in.
   *
   * `main` is the wide column on the left, for the things an editor is meant to
   * work through. `aside` is the narrow column on the right, for context they
   * should see but not necessarily act on — what is coming up, what is running.
   * Aside items render compactly, so put anything that needs reading room in
   * `main`.
   *
   * @defaultValue 'main'
   */
  placement?: 'main' | 'aside'

  /**
   * Who this source's items belong to.
   *
   * Purely a label: `mine` says the items are personal to the editor reading
   * them, `everyone` that the whole team sees the same list. An inbox mixing
   * both — your tasks alongside the team's forgotten drafts — is confusing
   * without it, because "done" means something different in each case.
   *
   * @defaultValue 'everyone'
   */
  audience?: 'mine' | 'everyone'

  /**
   * Whether a teammate's own Inbox could ever show this source's items at
   * all — a structural fact about where the data lives, not a display
   * preference. Not the same axis as `audience`: an `audience: 'mine'`
   * source (an `onlyMine`-scoped task feed, say) still reads a real, shared
   * Sanity document — a teammate with a different config would see the same
   * task. `'private'` is for the rare source with no shared document behind
   * it at all — `todos` is the one built-in example, kept in a per-editor
   * store nothing else ever reads. Drives the "Team"/"Only you"
   * section split in `MergedList.tsx`; when only one of the two is ever
   * populated, no split renders at all.
   *
   * @defaultValue 'shared'
   */
  visibility?: 'shared' | 'private'

  /**
   * Exempts this source's dismissals from the 90-day TTL that ages out every
   * other source's (see `DISMISSAL_TTL_DAYS` in `src/store/dismissals.ts`).
   *
   * Most sources want the TTL — a still-dismissed item resurfacing after this
   * long is a deliberate "you evidently haven't finished this" nudge. Turn
   * this on only for a source with no other way to mark something truly
   * finished (no `resolve`, and nothing external that could make a dismissed
   * item newly relevant again) — `todos` is the only built-in example, since
   * dismissing one is the only "done" a todo has.
   *
   * @defaultValue false
   */
  neverExpireDismissals?: boolean

  /**
   * Returns this source's items.
   *
   * This is a React hook — it may call `useClient`, `useActiveReleases`, or any
   * other — so it must obey the rules of hooks. The plugin renders one
   * component per source precisely so that each source's hooks get their own
   * stable call order, which means a source may return early or bail out
   * without disturbing its neighbours.
   */
  useItems: () => InboxSourceResult

  /**
   * A cheaper way to get just this source's live open count, without the
   * rest of `useItems()`'s payload (assignee joins, the `assess`/`assign`
   * capabilities, etc).
   *
   * Only used by this plugin's own always-mounted count provider
   * (`useInboxOpenCount()`, wired up automatically by `structureInbox()`),
   * which needs a live count from *outside* the structure tool's own
   * resolved pane tree — the one place some Studio context `useItems()` may
   * depend on (Sanity's addon dataset, used by Tasks) is reliably available.
   * The pane itself always calls `useItems()`, never this.
   *
   * Omit it and this source simply does not contribute to
   * `useInboxOpenCount()`'s total — it still works normally everywhere
   * else. That is a deliberate, safer default than falling back to
   * `useItems()` from this provider: a source whose `useItems()` depends on
   * context unavailable here would crash instead of just under-counting
   * (see `unpublishedDrafts.ts` and `openTasks.ts` for two built-in sources
   * that hit exactly this, and how each does or doesn't provide this).
   *
   * No `dismissals` parameter: whether an item is open never depends on
   * per-editor acknowledgement (see `splitItems.ts`'s own doc comment) —
   * only a real, source-confirmed `InboxItem.cleared` moves it out of open.
   */
  useOpenCount?: (snoozes: SnoozeState, now: number) => number | null
}
