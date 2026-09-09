import {type InboxSource} from './inbox/types'

/**
 * Options for {@link structureHome}.
 *
 * @public
 */
export interface StructureHomeConfig {
  /**
   * Which structure tool to attach to. Defaults to `structure`, the name
   * `structureTool()` uses unless given one. Set this when the Studio runs
   * several structure tools and only one should have a Home pane.
   */
  toolName?: string

  /**
   * The feeds that fill the inbox, in the order they appear.
   */
  sources?: InboxSource[]

  /**
   * Title shown on the Home pane and on its item in the root list.
   * Defaults to the localized `home.title`.
   */
  title?: string

  /**
   * Whether to show a "Home" item at the top of the root list.
   *
   * Off by default: editors land on the Home pane without clicking anything,
   * and clicking the tool in the navbar brings them back, so the entry mostly
   * takes up room in a list the developer designed. Turn it on if you want an
   * explicit way in — or place {@link homeListItem} yourself to control where
   * it sits.
   *
   * @defaultValue false
   */
  showInList?: boolean

  /**
   * Whether to send editors to the Home pane when they land on the tool with
   * nothing selected. Turning this off leaves the Home item in the list as
   * something the editor opens themselves.
   *
   * @defaultValue true
   */
  redirectOnLanding?: boolean
}

/** @internal */
export type ResolvedStructureHomeConfig = Required<
  Pick<StructureHomeConfig, 'toolName' | 'showInList' | 'redirectOnLanding' | 'sources'>
> &
  Pick<StructureHomeConfig, 'title'>
