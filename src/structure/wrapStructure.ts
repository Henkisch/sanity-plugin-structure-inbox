import {ListBuilder, type StructureResolver} from 'sanity/structure'

import {type ResolvedStructureHomeConfig} from '../types'
import {warnOnce} from '../warnOnce'
import {setHomeAvailable} from './homeAvailability'
import {homeListItem} from './homeNode'

/**
 * `ListBuilder` is a class, so `instanceof` is the exact test — and it holds as
 * long as the Studio and this plugin share one copy of `sanity`, which is what
 * the peer dependency is there to guarantee. A Studio with two copies of
 * `sanity` loaded has larger problems than a missing Home item.
 */
function isListBuilder(value: unknown): value is ListBuilder {
  return value instanceof ListBuilder
}

/**
 * Wraps the developer's structure resolver so the root list gains a Home item.
 *
 * `StructureToolBoundary` reads its resolver from `tool.options.structure`, so
 * replacing that option is enough — the plugin never has to reimplement the
 * tool, and a developer's own structure keeps working untouched.
 *
 * Injection is only possible when the root node is a list. A structure whose
 * root is a document list (`S.documentTypeList('post')`), or one that resolves
 * asynchronously, is returned unchanged and marks the tool unavailable so the
 * landing redirect stays off. That degradation is deliberate: the alternative
 * is sending editors to a URL whose pane cannot resolve.
 *
 * @internal
 */
export function wrapStructure(
  inner: StructureResolver | undefined,
  config: ResolvedStructureHomeConfig,
): StructureResolver {
  return (S, context) => {
    const base = inner ? inner(S, context) : S.defaults()

    if (!config.autoInject) {
      // The developer places `homeListItem` themselves. Trust them: if they
      // forget, the pane simply fails to resolve and the canvas stays blank,
      // which is exactly what it looked like before this plugin.
      setHomeAvailable(config.toolName, true)
      return base
    }

    if (!isListBuilder(base)) {
      warnOnce(
        `The structure for tool "${config.toolName}" does not have a list at its root, so the Home item could not be added and the landing redirect is disabled. ` +
          `Either return S.list() from your structure resolver, or set autoInject: false and place homeListItem(S) yourself.`,
      )
      setHomeAvailable(config.toolName, false)
      return base
    }

    setHomeAvailable(config.toolName, true)

    return base.items([homeListItem(S, config), S.divider(), ...(base.getItems() ?? [])])
  }
}
