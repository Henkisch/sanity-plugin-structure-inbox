import {type DismissalState} from './store/dismissals'
import {type SnoozeState} from './store/snoozes'
import {type InboxItem} from './inbox/types'
import {splitItems} from './inbox/splitItems'

/** One configured source's name and its currently-fetched items. */
export interface DigestSource {
  /** Must match the `sourceName` `isDismissed`/`isSnoozed` were recorded against — the same `source.name` passed to `structureInbox({sources: [...]})`. */
  name: string
  items: InboxItem[]
}

/** One editor's parsed per-editor state — the output of `parseDismissals`/`parseSnoozes` on their own documents. */
export interface DigestEditor {
  userId: string
  dismissals: DismissalState
  snoozes: SnoozeState
}

/** What's still open for one editor, across every source. */
export interface EditorDigest {
  userId: string
  open: InboxItem[]
}

/**
 * Builds each editor's "what's still open" list — the same open/done/snoozed
 * split every rendered inbox uses (`splitItems`), run once per editor across
 * every source, with nothing kept but what's still open. Whether "open"
 * counts snoozed-but-not-yet-woken items is the caller's call — this
 * function only reports fully open ones, matching what the pane's own
 * headline count already treats as "waiting on you" (see `Inbox.tsx`'s
 * `openCount`, which sums only `.open`, never `.snoozed`).
 */
export function buildDigest(
  sources: DigestSource[],
  editors: DigestEditor[],
  now = Date.now(),
): EditorDigest[] {
  return editors.map((editor) => ({
    userId: editor.userId,
    open: sources.flatMap(
      (source) => splitItems(source.items, source.name, editor.dismissals, editor.snoozes, now).open,
    ),
  }))
}
