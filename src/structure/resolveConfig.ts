import {DEFAULT_TOOL_NAME} from '../constants'
import {type ResolvedStructureHomeConfig, type StructureHomeConfig} from '../types'

/**
 * Fills in the defaults once, so nothing downstream has to repeat
 * `config.autoInject ?? true`.
 *
 * @internal
 */
export function resolveConfig(config: StructureHomeConfig = {}): ResolvedStructureHomeConfig {
  return {
    toolName: config.toolName ?? DEFAULT_TOOL_NAME,
    showInList: config.showInList ?? false,
    redirectOnLanding: config.redirectOnLanding ?? true,
    sources: config.sources ?? [],
    title: config.title,
  }
}
