import {definePlugin, type Tool} from 'sanity'
import {type StructureToolOptions} from 'sanity/structure'

import {PLUGIN_NAME} from './constants'
import {structureHomeLocaleBundles} from './i18n'
import {resolveConfig} from './structure/resolveConfig'
import {wrapStructure} from './structure/wrapStructure'
import {createActiveToolLayout} from './studio/createActiveToolLayout'
import {type StructureHomeConfig} from './types'
import {warnOnce} from './warnOnce'

/**
 * Fills the Structure tool's empty canvas with a Home pane.
 *
 * List this **after** `structureTool()` in `plugins`: the plugin works by
 * wrapping the structure tool that is already in the array, so a tool that has
 * not been added yet cannot be found.
 *
 * ```ts
 * export default defineConfig({
 *   plugins: [
 *     structureTool(),
 *     structureHome({widgets: [recentlyEdited()]}),
 *   ],
 * })
 * ```
 *
 * @public
 */
export const structureHome = definePlugin<StructureHomeConfig | void>((options) => {
  const config = resolveConfig(options || undefined)

  return {
    name: PLUGIN_NAME,

    studio: {
      components: {
        activeToolLayout: createActiveToolLayout(config),
      },
    },

    tools: (prev) => {
      const target = prev.find((tool) => tool.name === config.toolName)

      if (!target) {
        warnOnce(
          `No tool named "${config.toolName}" was found, so no Home pane was added. ` +
            `List structureHome() after structureTool() in your plugins array, or pass toolName if your structure tool is named something else.`,
        )
        return prev
      }

      return prev.map((tool): Tool => {
        if (tool !== target) return tool

        // `StructureToolBoundary` reads the resolver back out of
        // `tool.options.structure`, so swapping that option is all it takes to
        // extend someone else's structure without reimplementing the tool.
        const options: StructureToolOptions | undefined = tool.options

        return {
          ...tool,
          options: {...options, structure: wrapStructure(options?.structure, config)},
        }
      })
    },

    i18n: {
      bundles: structureHomeLocaleBundles,
    },
  }
})
