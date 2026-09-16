import {InboxIcon} from '@sanity/icons/Inbox'
import {type ComponentBuilder, type ListItemBuilder, type StructureBuilder} from 'sanity/structure'

import {INBOX_PANE_ID, STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type ResolvedStructureInboxConfig, type StructureInboxConfig} from '../types'
import {InboxPane} from './InboxPane'
import {resolveConfig} from './resolveConfig'

/** Applies the title the same way to the pane's own list item. */
function withTitle<
  T extends {title(t: string): T; i18n(i18n: {title: {key: string; ns: string}}): T},
>(builder: T, config: ResolvedStructureInboxConfig): T {
  if (config.title) return builder.title(config.title)
  // No explicit title, so follow the editor's Studio language. `useI18nText`
  // gives the i18n key precedence over `title`, which stays as the fallback for
  // a Studio that somehow has no bundle loaded.
  return builder.title('Inbox').i18n({title: {key: 'inbox.title', ns: STRUCTURE_INBOX_NAMESPACE}})
}

/**
 * The Inbox pane itself, as a structure node.
 *
 * `canHandleIntent` is pinned to `false` rather than left undefined: intent
 * resolution walks every node in the root list looking for something that can
 * open a document, and a pane that renders a dashboard should never win that
 * race. Leaving it unset happens to behave the same today; saying it outright
 * means a future default cannot change the answer.
 *
 * Deliberately has no `.title()` of its own, unlike `inboxListItem` below —
 * a component pane with no title renders with no breadcrumb bar above it
 * at all (confirmed live), rather than falling back to its id or anything
 * else. That bar only ever repeated what the pane's own headline
 * (`Inbox.tsx`) already says, and it cost real vertical space doing it.
 *
 * @internal
 */
export function inboxComponent(
  S: StructureBuilder,
  config: ResolvedStructureInboxConfig,
): ComponentBuilder {
  return S.component(InboxPane)
    .id(INBOX_PANE_ID)
    .canHandleIntent(() => false)
    .options({
      sources: config.sources,
      ask: config.ask,
      contentGaps: config.contentGaps,
      context: config.context,
    })
}

/**
 * The Inbox pane's entry in the root list.
 *
 * The pane is reachable without it — the plugin teaches the root pane to
 * resolve the Inbox id directly — so reach for this only when you want a
 * visible entry in a particular place. For one at the top of the list,
 * `showInList: true` does the same thing with no structure changes.
 *
 * ```ts
 * structureTool({
 *   structure: (S) =>
 *     S.list()
 *       .title('Content')
 *       .items([...S.documentTypeListItems(), S.divider(), inboxListItem(S)]),
 * })
 * ```
 *
 * @public
 */
export function inboxListItem(
  S: StructureBuilder,
  config: StructureInboxConfig = {},
): ListItemBuilder {
  const resolved = resolveConfig(config)
  return withTitle(S.listItem().id(INBOX_PANE_ID), resolved)
    .icon(InboxIcon)
    .child(inboxComponent(S, resolved))
}
