import {
  type PaneNode,
  type RouterPaneSiblingContext,
  type SerializeOptions,
  type StructureBuilder,
  type StructureResolver,
} from 'sanity/structure'

import {HOME_PANE_ID} from '../constants'
import {type ResolvedStructureHomeConfig} from '../types'
import {warnOnce} from '../warnOnce'
import {setHomeAvailable} from './homeAvailability'
import {homeComponent, homeListItem} from './homeNode'

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
 * Home pane's id resolves to the Home pane, everything else is handed to
 * whatever the node already resolved children with.
 *
 * This is what lets the Home pane exist without a visible entry in the root
 * list. Pane resolution reaches a child purely by id — the list item is only
 * the ordinary way an editor produces that id — so teaching the root to answer
 * for one extra id is enough, and the developer's list is left exactly as they
 * wrote it.
 */
function addHomeChild(
  S: StructureBuilder,
  node: PaneNode,
  config: ResolvedStructureHomeConfig,
): unknown {
  const inherited = node.child

  return {
    ...node,
    child: (itemId: string, context: RouterPaneSiblingContext) => {
      if (itemId === HOME_PANE_ID) return homeComponent(S, config)
      if (typeof inherited === 'function') return inherited(itemId, context)
      return inherited
    },
  }
}

/**
 * Wraps the developer's structure resolver so the Home pane is reachable.
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
  config: ResolvedStructureHomeConfig,
): StructureResolver {
  return (S, context) => {
    const base = inner ? inner(S, context) : S.defaults()

    const withHome = (root: unknown): unknown => {
      if (isSerializable(root)) {
        setHomeAvailable(config.toolName, true)
        return {
          serialize: (options?: SerializeOptions) =>
            addHomeChild(S, root.serialize(options), config),
        }
      }

      if (isPaneNode(root)) {
        setHomeAvailable(config.toolName, true)
        return addHomeChild(S, root, config)
      }

      warnOnce(
        `The structure for tool "${config.toolName}" resolved to something this plugin cannot extend, so the Home pane is unreachable and the landing redirect is disabled. ` +
          `This happens when a structure resolver returns an observable; return a structure node, a builder, or a promise instead.`,
      )
      setHomeAvailable(config.toolName, false)
      return root
    }

    // A resolver is allowed to be async, and the common reason — awaiting a
    // client call before building the list — has nothing to do with us.
    if (isPromiseLike(base)) return base.then(withHome)

    return withHome(config.showInList ? addHomeListItem(S, base, config) : base)
  }
}

/**
 * Adds the Home item to the top of the root list, above a divider.
 *
 * Only reachable via `showInList`, and only meaningful when the root is a list
 * — a document list has no items to add to. Resolution does not depend on this
 * succeeding, so a root without items is left alone silently rather than
 * warning about something the editor will never notice.
 */
function addHomeListItem(
  S: StructureBuilder,
  base: unknown,
  config: ResolvedStructureHomeConfig,
): unknown {
  if (!hasMethod(base, 'items') || !hasMethod(base, 'getItems')) {
    warnOnce(
      `showInList is on, but the structure for tool "${config.toolName}" does not have a list at its root, so there is nowhere to put the Home item. ` +
        `The Home pane still opens on landing.`,
    )
    return base
  }

  const existing: unknown = base.getItems()
  const items = [homeListItem(S, config), S.divider(), ...(Array.isArray(existing) ? existing : [])]

  // `hasMethod` only proves `items` is callable, so the argument is untyped
  // here. The real type check happened where the caller built its list.
  return base.items(items)
}
