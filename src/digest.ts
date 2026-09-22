import {type SnoozeState} from './store/snoozes'
import {type InboxItem} from './inbox/types'
import {splitItems} from './inbox/splitItems'

/**
 * One configured source's name and its currently-fetched items.
 *
 * @public
 */
export interface DigestSource {
  /** Must match the `sourceName` `isSnoozed` was recorded against — the same `source.name` passed to `structureInbox({sources: [...]})`. */
  name: string
  items: InboxItem[]
}

/**
 * One editor's parsed per-editor state — the output of `parseSnoozes` on
 * their own document. No `dismissals` here: acknowledging an item is a
 * personal "I've seen this" marker, never a reason to leave it out of a
 * digest of what's still genuinely open — only `InboxItem.cleared` (a real,
 * source-confirmed resolution) does that. See `splitItems.ts`'s own doc
 * comment.
 *
 * @public
 */
export interface DigestEditor {
  userId: string
  snoozes: SnoozeState
}

/**
 * What's still open for one editor, across every source.
 *
 * @public
 */
export interface EditorDigest {
  userId: string
  open: InboxItem[]
}

/**
 * Builds each editor's "what's still open" list — the same open/cleared/
 * snoozed split every rendered inbox uses (`splitItems`), run once per
 * editor across every source, with nothing kept but what's still open.
 * Whether "open" counts snoozed-but-not-yet-woken items is the caller's
 * call — this function only reports fully open ones, matching what the
 * pane's own headline count already treats as "waiting on you" (see
 * `Inbox.tsx`'s `openCount`, which sums only `.open`, never `.snoozed`).
 *
 * @public
 */
export function buildDigest(
  sources: DigestSource[],
  editors: DigestEditor[],
  now = Date.now(),
): EditorDigest[] {
  return editors.map((editor) => ({
    userId: editor.userId,
    open: sources.flatMap(
      (source) => splitItems(source.items, source.name, editor.snoozes, now).open,
    ),
  }))
}
