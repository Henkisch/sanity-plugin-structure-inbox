import {UsersIcon} from '@sanity/icons/Users'
import {definePlugin, type Tool} from 'sanity'

import {openTasks} from '../inbox/sources/openTasks'
import {unpublishedDrafts} from '../inbox/sources/unpublishedDrafts'
import {type InboxSource} from '../inbox/types'
import {createTeamViewTool} from './TeamViewTool'

export interface StructureInboxTeamViewConfig {
  /**
   * The `'everyone'`-audience sources to aggregate. Defaults to
   * `[unpublishedDrafts(), openTasks({onlyMine: false})]`.
   *
   * Any `audience: 'mine'` source you pass (e.g. `todos()`) is silently
   * dropped — a personal scratch list has no place in a team-wide view, the
   * same reasoning `todos()` itself documents for why it is always
   * `audience: 'mine'`.
   */
  sources?: InboxSource[]
  /** Tool name. @defaultValue 'structure-inbox-team-view' */
  toolName?: string
  /** Title shown on the tool's own tab. @defaultValue 'Team' */
  title?: string
}

/**
 * A separate, opt-in Studio tool: every configured `'everyone'`-audience
 * source's currently-open items, grouped by assignee instead of by
 * tone/timestamp — "who's sitting on what," for a lead surveying the whole
 * team rather than one editor's own queue.
 *
 * Deliberately not part of `structureInbox()` itself — a different
 * audience, a different question. Add both if you want both:
 *
 * ```ts
 * plugins: [
 *   structureTool(),
 *   structureInbox({sources: [...]}),
 *   structureInboxTeamView(),
 * ]
 * ```
 *
 * Every editor who can open this tool sees the same aggregated view — the
 * same `'everyone'`-audience data already readable through the personal
 * Inbox pane, just grouped differently. This plugin adds no new visibility
 * gating of its own; restricting who can open the tool itself is your
 * Studio's own access-control setup to make, same as any other tool.
 *
 * @public
 */
export const structureInboxTeamView = definePlugin<StructureInboxTeamViewConfig | void>(
  (options) => {
    const sources = (options?.sources ?? [unpublishedDrafts(), openTasks({onlyMine: false})]).filter(
      (source) => (source.audience ?? 'everyone') === 'everyone',
    )
    const toolName = options?.toolName ?? 'structure-inbox-team-view'
    const title = options?.title ?? 'Team'

    return {
      name: 'sanity-plugin-structure-inbox/team-view',
      tools: (prev): Tool[] => [
        ...prev,
        {
          name: toolName,
          title,
          icon: UsersIcon,
          component: createTeamViewTool({sources, title}),
        },
      ],
    }
  },
)
