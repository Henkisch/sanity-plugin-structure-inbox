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
  assess?: (item: InboxItem) => Promise<string>
  /**
   * Delegates an item to someone else by creating a real Sanity Task.
   *
   * `users` is who it can go to; `toUser` does the assigning. Bundled
   * together, rather than a bare function, because the list of people to
   * offer is the source's own concern — it knows which dataset (and which
   * permission) makes someone a sensible assignee — not something the
   * generic selection bar should have an opinion on.
   *
   * Optional: only a source with somewhere for a task to point at makes sense
   * to delegate. `openTasks`'s own items are already tasks, and `todos` has
   * no one else to hand a personal item to.
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
  }
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
