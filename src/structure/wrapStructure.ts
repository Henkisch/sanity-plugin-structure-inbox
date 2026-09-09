import {
  type PaneNode,
  type RouterPaneSiblingContext,
  type SerializeOptions,
  type StructureBuilder,
  type StructureResolver,
} from 'sanity/structure'

import {INBOX_PANE_ID} from '../constants'
import {type ResolvedStructureInboxConfig} from '../types'
import {warnOnce} from '../warnOnce'
import {setInboxAvailable} from './inboxAvailability'
import {inboxComponent, inboxListItem} from './inboxNode'

/** Anything with a `serialize()` — every structure builder, and nothing else. */
interface SerializableNode {
  serialize: (options?: SerializeOptions) => PaneNode
}

function hasMethod<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, (...args: unknown[]) => unknown> {
  if (typeof value === 'undefined' || value === null) return false
  // `Reflect.get` rather than a property read, because these methods live on a
  // builder's prototype — spreading or destructuring would lose them.
  return typeof Reflect.get(Object(value), key) === 'function'
}

function isSerializable(value: unknown): value is SerializableNode {
  return hasMethod(value, 'serialize')
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return hasMethod(value, 'then')
}

function isPaneNode(value: unknown): value is PaneNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

/**
 * Returns the root pane node with one extra branch in its child resolver: the
 * Inbox pane's id resolves to the Inbox pane, everything else is handed to
 * whatever the node already resolved children with.
 *
 * This is what lets the Inbox pane exist without a visible entry in the root
 * list. Pane resolution reaches a child purely by id — the list item is only
 * the ordinary way an editor produces that id — so teaching the root to answer
 * for one extra id is enough, and the developer's list is left exactly as they
 * wrote it.
 */
function addInboxChild(
  S: StructureBuilder,
  node: PaneNode,
  config: ResolvedStructureInboxConfig,
): unknown {
  const inherited = node.child

  return {
    ...node,
    child: (itemId: string, context: RouterPaneSiblingContext) => {
      if (itemId === INBOX_PANE_ID) return inboxComponent(S, config)
      if (typeof inherited === 'function') return inherited(itemId, context)
      return inherited
    },
  }
}

/**
 * Wraps the developer's structure resolver so the Inbox pane is reachable.
 *
 * `StructureToolBoundary` reads its resolver back out of
 * `tool.options.structure`, so replacing that option is enough — the plugin
 * never reimplements the tool, and an existing structure keeps working.
 *
 * The wrapping happens at the serialized-node level rather than on a specific
 * builder, so it applies whatever the root turns out to be: a list, a document
 * list, a component. Only a root that resolves through an observable is left
 * alone, because there is no way to extend one without subscribing to it here.
 */
export function wrapStructure(
  inner: StructureResolver | undefined,
  config: ResolvedStructureInboxConfig,
): StructureResolver {
  return (S, context) => {
    const base = inner ? inner(S, context) : S.defaults()

    const withInbox = (resolved: unknown): unknown => {
      const root = config.showInList ? addInboxListItem(S, resolved, config) : resolved

      if (isSerializable(root)) {
        setInboxAvailable(config.toolName, true)
        return {
          serialize: (options?: SerializeOptions) =>
            addInboxChild(S, root.serialize(options), config),
        }
      }

      if (isPaneNode(root)) {
        setInboxAvailable(config.toolName, true)
        return addInboxChild(S, root, config)
      }

      warnOnce(
        `The structure for tool "${config.toolName}" resolved to something this plugin cannot extend, so the Inbox pane is unreachable and the landing redirect is disabled. ` +
          `This happens when a structure resolver returns an observable; return a structure node, a builder, or a promise instead.`,
      )
      setInboxAvailable(config.toolName, false)
      return root
    }

    // A resolver is allowed to be async, and the common reason — awaiting a
    // client call before building the list — has nothing to do with us.
    // `withInbox` applies `addInboxListItem` itself, so both branches funnel
    // through the same single call site regardless of when `base` resolves.
    if (isPromiseLike(base)) return base.then(withInbox)

    return withInbox(base)
  }
}

/**
 * Adds the Inbox item to the top of the root list, above a divider.
 *
 * Only reachable via `showInList`, and only meaningful when the root is a list
 * — a document list has no items to add to. Resolution does not depend on this
 * succeeding, so a root without items is left alone silently rather than
 * warning about something the editor will never notice.
 */
function addInboxListItem(
  S: StructureBuilder,
  base: unknown,
  config: ResolvedStructureInboxConfig,
): unknown {
  if (!hasMethod(base, 'items') || !hasMethod(base, 'getItems')) {
    warnOnce(
      `showInList is on, but the structure for tool "${config.toolName}" does not have a list at its root, so there is nowhere to put the Inbox item. ` +
        `The Inbox pane still opens on landing.`,
    )
    return base
  }

  const existing: unknown = base.getItems()
  const items = [
    inboxListItem(S, config),
    S.divider(),
    ...(Array.isArray(existing) ? existing : []),
  ]

  // `hasMethod` only proves `items` is callable, so the argument is untyped
  // here. The real type check happened where the caller built its list.
  return base.items(items)
}
