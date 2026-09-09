import {HomeIcon} from '@sanity/icons/Home'
import {type ComponentBuilder, type ListItemBuilder, type StructureBuilder} from 'sanity/structure'

import {HOME_PANE_ID, STRUCTURE_HOME_NAMESPACE} from '../constants'
import {type ResolvedStructureHomeConfig, type StructureHomeConfig} from '../types'
import {HomePane} from './HomePane'
import {resolveConfig} from './resolveConfig'

/** Applies the title the same way to the pane and to its list item. */
function withTitle<
  T extends {title(t: string): T; i18n(i18n: {title: {key: string; ns: string}}): T},
>(builder: T, config: ResolvedStructureHomeConfig): T {
  if (config.title) return builder.title(config.title)
  // No explicit title, so follow the editor's Studio language. `useI18nText`
  // gives the i18n key precedence over `title`, which stays as the fallback for
  // a Studio that somehow has no bundle loaded.
  return builder.title('Home').i18n({title: {key: 'home.title', ns: STRUCTURE_HOME_NAMESPACE}})
}

/**
 * The Home pane itself, as a structure node.
 *
 * `canHandleIntent` is pinned to `false` rather than left undefined: intent
 * resolution walks every node in the root list looking for something that can
 * open a document, and a pane that renders a dashboard should never win that
 * race. Leaving it unset happens to behave the same today; saying it outright
 * means a future default cannot change the answer.
 *
 * @internal
 */
export function homeComponent(
  S: StructureBuilder,
  config: ResolvedStructureHomeConfig,
): ComponentBuilder {
  return withTitle(S.component(HomePane).id(HOME_PANE_ID), config)
    .canHandleIntent(() => false)
    .options({sources: config.sources})
}

/**
 * The Home pane's entry in the root list.
 *
 * The pane is reachable without it — the plugin teaches the root pane to
 * resolve the Home id directly — so reach for this only when you want a
 * visible entry in a particular place. For one at the top of the list,
 * `showInList: true` does the same thing with no structure changes.
 *
 * ```ts
 * structureTool({
 *   structure: (S) =>
 *     S.list()
 *       .title('Content')
 *       .items([...S.documentTypeListItems(), S.divider(), homeListItem(S)]),
 * })
 * ```
 *
 * @public
 */
export function homeListItem(
  S: StructureBuilder,
  config: StructureHomeConfig = {},
): ListItemBuilder {
  const resolved = resolveConfig(config)
  return withTitle(S.listItem().id(HOME_PANE_ID), resolved)
    .icon(HomeIcon)
    .child(homeComponent(S, resolved))
}
