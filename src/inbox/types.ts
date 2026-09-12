import {type ComponentType} from 'react'

/**
 * Which slice of the inbox is on screen: the things still to do, the things
 * already ticked off, or the things put off until later.
 *
 * @public
 */
export type InboxView = 'open' | 'done' | 'snoozed'

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
  icon?: ComponentType
  /** Colours the row. Use sparingly — everything urgent means nothing is. */
  tone?: 'default' | 'primary' | 'positive' | 'caution' | 'critical'
  /**
   * Where clicking the row takes the editor. Omit for an item with nowhere to go.
   */
  intent?: {
    type: 'edit' | 'create'
    params: {id?: string; type?: string; [key: string]: string | undefined}
  }
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
  }
  /**
   * Deletes an item for good — unlike marking it done, which only removes it
   * from this editor's own inbox while leaving it wherever it actually
   * lives. Optional: only a source that keeps its own items, with nowhere
   * else preserving a record of them, has a reason to offer this — `todos`
   * does, so a finished one doesn't just sit dismissed forever.
   */
  remove?: (item: InboxItem) => Promise<void> | void
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
   * Returns this source's items.
   *
   * This is a React hook — it may call `useClient`, `useActiveReleases`, or any
   * other — so it must obey the rules of hooks. The plugin renders one
   * component per source precisely so that each source's hooks get their own
   * stable call order, which means a source may return early or bail out
   * without disturbing its neighbours.
   */
  useItems: () => InboxSourceResult
}
