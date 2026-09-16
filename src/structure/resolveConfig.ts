import {DEFAULT_TOOL_NAME} from '../constants'
import {type ResolvedStructureInboxConfig, type StructureInboxConfig} from '../types'

/**
 * Fills in the defaults once, so nothing downstream has to repeat
 * `config.showInList ?? false`.
 *
 * @internal
 */
export function resolveConfig(config: StructureInboxConfig = {}): ResolvedStructureInboxConfig {
  return {
    toolName: config.toolName ?? DEFAULT_TOOL_NAME,
    showInList: config.showInList ?? false,
    redirectOnLanding: config.redirectOnLanding ?? true,
    sources: config.sources ?? [],
    ask: config.ask ?? false,
    title: config.title,
    contentGaps: config.contentGaps,
  }
}
