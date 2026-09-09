import {type ComponentType} from 'react'

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
  /** When this became relevant. Shown as a relative time, and used to order within a group. */
  timestamp?: string
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
