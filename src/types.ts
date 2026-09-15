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
   * Title shown on the Inbox pane and on its item in the root list.
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
}

/** @internal */
export type ResolvedStructureInboxConfig = Required<
  Pick<StructureInboxConfig, 'toolName' | 'showInList' | 'redirectOnLanding' | 'sources' | 'ask'>
> &
  Pick<StructureInboxConfig, 'title'>
