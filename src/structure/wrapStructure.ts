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
      // Checked before the list item, not after: an unextendable root has no
      // Inbox pane at all, and complaining about where its entry would have
      // gone on top of that would only bury the one warning that matters.
      if (!isSerializable(resolved) && !isPaneNode(resolved)) {
        warnOnce(
          `The structure for tool "${config.toolName}" resolved to something this plugin cannot extend, so the Inbox pane is unreachable and the landing redirect is disabled. ` +
            `This happens when a structure resolver returns an observable; return a structure node, a builder, or a promise instead.`,
        )
        setInboxAvailable(config.toolName, false)
        return resolved
      }

      const root = addInboxListItem(S, resolved, config)
      setInboxAvailable(config.toolName, true)

      if (isSerializable(root)) {
        return {
          serialize: (options?: SerializeOptions) =>
            addInboxChild(S, root.serialize(options), config),
        }
      }

      // `addInboxListItem` either returns its input or a builder built from
      // it, so the only way to be here is a plain pane node that already
      // passed `isPaneNode` above. Re-narrowing says so to the type system
      // rather than asserting it.
      if (isPaneNode(root)) return addInboxChild(S, root, config)

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
 * Puts the Inbox item at the top of the root list, unless the developer has
 * already placed one themselves.
 *
 * Not optional, and deliberately so: below `theme.sanity.media[1]` the
 * structure tool shows one pane at a time and the landing redirect is skipped
 * (see `useCollapsedLayout`), which makes this entry the only way into the
 * Inbox on a phone. A structure is serialized once, before any viewport is
 * known, so it cannot be added for narrow screens alone. Developers who want
 * the entry somewhere other than the top place `inboxListItem` themselves and
 * this leaves it alone.
 *
 * Only meaningful when the root is a list — a document list has no items to
 * add to. Resolution does not depend on this succeeding, so a root without
 * items is left alone rather than treated as an error.
 */
function addInboxListItem(
  S: StructureBuilder,
  base: unknown,
  config: ResolvedStructureInboxConfig,
): unknown {
  if (!hasMethod(base, 'items') || !hasMethod(base, 'getItems')) {
    warnOnce(
      `The structure for tool "${config.toolName}" does not have a list at its root, so there is nowhere to put the Inbox item. ` +
        `The pane still opens on landing, but on a narrow viewport — where the structure tool shows one pane at a time and that redirect is skipped — editors have no way to reach it.`,
    )
    return base
  }

  const existing: unknown = base.getItems()
  const items = Array.isArray(existing) ? existing : []

  // A developer who placed `inboxListItem(S)` themselves already has an entry,
  // and adding a second one at the top would be a duplicate rather than a
  // convenience.
  if (items.some(isInboxItem)) return base

  // `hasMethod` only proves `items` is callable, so the argument is untyped
  // here. The real type check happened where the caller built its list.
  return base.items([inboxListItem(S, config), S.divider(), ...items])
}

/**
 * Whether a root-list entry is an Inbox item the developer placed themselves.
 *
 * Both the builder and its serialized form carry the id, and a root list can
 * hold either — `getItems()` returns whatever the developer put in. Reading
 * `.getId()` through `hasMethod` rather than calling `serialize()` keeps this
 * from throwing on a half-built item that the structure tool would have
 * reported on itself, far more legibly, a moment later.
 */
function isInboxItem(item: unknown): boolean {
  if (hasMethod(item, 'getId')) return item.getId() === INBOX_PANE_ID
  if (typeof item === 'object' && item !== null && 'id' in item) return item.id === INBOX_PANE_ID
  return false
}
