import {type InboxSource} from './inbox/types'

/**
 * Options for {@link structureInbox}.
 *
 * @public
 */
export interface StructureInboxConfig {
  /**
   * Which structure tool to attach to. Defaults to `structure`, the name
   * `structureTool()` uses unless given one. Set this when the Studio runs
   * several structure tools and only one should have a Inbox pane.
   */
  toolName?: string

  /**
   * The feeds that fill the inbox, in the order they appear.
   */
  sources?: InboxSource[]

  /**
   * Title for the "Inbox" entry in the root list, when {@link inboxListItem}
   * (or `showInList`) puts one there. The pane itself has no title bar of
   * its own to show this on — see `inboxComponent`'s own doc comment.
   * Defaults to the localized `inbox.title`.
   */
  title?: string

  /**
   * Whether to show a "Inbox" item at the top of the root list.
   *
   * Off by default: editors land on the Inbox pane without clicking anything,
   * and clicking the tool in the navbar brings them back, so the entry mostly
   * takes up room in a list the developer designed. Turn it on if you want an
   * explicit way in — or place {@link inboxListItem} yourself to control where
   * it sits.
   *
   * @defaultValue false
   */
  showInList?: boolean

  /**
   * Whether to send editors to the Inbox pane when they land on the tool with
   * nothing selected. Turning this off leaves the Inbox item in the list as
   * something the editor opens themselves.
   *
   * @defaultValue true
   */
  redirectOnLanding?: boolean

  /**
   * Lets an editor select rows by asking a plain-language question ("things
   * about the spring campaign") instead of reading and ticking each one —
   * shown as a single-line input in the Open view's own header.
   *
   * The AI's only output is a selection: it never resolves, dismisses, or
   * snoozes anything itself, and only rows already on screen (after any
   * active filter) are candidates. Off by default: it spends an Agent
   * Actions request per question, and needs Agent Actions available in the
   * Studio (silently does nothing useful without it — the input still
   * renders, since knowing that in advance would need its own request).
   *
   * @defaultValue false
   */
  ask?: boolean

  /**
   * Enables "Find content gaps" — a pane-level AI read that surveys every
   * document type (a sample of real content plus counts, not just schema
   * shape) and suggests what might be missing, shown as a dismissible card
   * the same way Summarize's own read is.
   *
   * Off by default, unlike every other read in this pane: this is a
   * judgment call, not a fact — a broken reference or a failed validation
   * rule is objectively true, "you're missing case studies" is an AI's
   * opinion, right or wrong. It's also the heaviest read here (every
   * document type, not 20-30 rows), so it should be a deliberate opt-in,
   * not a default cost every Studio pays. Still a marker object, not a
   * boolean — leaves room for its own options later without a breaking
   * change, the same reasoning every other object-shaped option here uses.
   *
   * @defaultValue undefined (off)
   */
  contentGaps?: Record<string, never>

  /**
   * Prose describing this project's own business/positioning — grounds
   * every AI read in this pane (Summarize, Suggest todos, Ask, Find
   * content gaps) in what the project actually *is*, not just what's in
   * front of it right now. Schema shape and row titles alone can't reveal
   * that a project promotes a service it has no case studies for, or what
   * "worth starting first" even means for this particular business.
   *
   * Optional: every read still functions without it, just with a weaker,
   * more generic signal — `contentGaps` in particular falls back to
   * inferring context purely from a sample of existing document text.
   * Deliberately not threaded into any per-document read (`assess`,
   * `proposeFix`, `suggestSnooze`) — those already ground themselves in
   * one concrete document, where this adds far less than it does for a
   * judgment call across the whole project.
   */
  context?: string
}

/** @internal */
export type ResolvedStructureInboxConfig = Required<
  Pick<StructureInboxConfig, 'toolName' | 'showInList' | 'redirectOnLanding' | 'sources' | 'ask'>
> &
  Pick<StructureInboxConfig, 'title' | 'contentGaps' | 'context'>
