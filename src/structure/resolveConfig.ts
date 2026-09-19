import {DEFAULT_TOOL_NAME} from '../constants'
import {type ResolvedStructureInboxConfig, type StructureInboxConfig} from '../types'

/**
 * Fills in the defaults once, so nothing downstream has to repeat
 * `config.redirectOnLanding ?? true`.
 *
 * @internal
 */
export function resolveConfig(config: StructureInboxConfig = {}): ResolvedStructureInboxConfig {
  return {
    toolName: config.toolName ?? DEFAULT_TOOL_NAME,
    redirectOnLanding: config.redirectOnLanding ?? true,
    sources: config.sources ?? [],
    ask: config.ask ?? false,
    summarize: config.summarize ?? true,
    suggestTodos: config.suggestTodos ?? true,
    title: config.title,
    contentGaps: config.contentGaps,
    context: config.context,
  }
}
