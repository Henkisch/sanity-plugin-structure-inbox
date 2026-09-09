import {
  createStructureBuilder,
  type PaneNode,
  type RouterPaneSiblingContext,
  type StructureBuilder,
  type StructureResolverContext,
} from 'sanity/structure'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {INBOX_PANE_ID} from '../constants'
import {resetWarnings} from '../warnOnce'
import {isInboxAvailable, resetInboxAvailability} from './inboxAvailability'
import {resolveConfig} from './resolveConfig'
import {wrapStructure} from './wrapStructure'

/**
 * A real `StructureBuilder`, so these tests exercise the actual builders
 * `wrapStructure` wraps rather than stubs that agree with it.
 *
 * `createStructureBuilder` wants a Studio `Source`, which is far too large to
 * construct here. Building and serializing the nodes below only reaches for
 * three pieces of it — the schema, i18n, and new-document options — so those
 * three stubs are the whole of the fixture.
 */
const S: StructureBuilder = createStructureBuilder({
  source: {
    schema: {get: () => undefined, getTypeNames: () => []},
    i18n: {t: (key: string) => key},
    document: {resolveNewDocumentOptions: () => []},
  },
} as never)

const context = {} as StructureResolverContext

/** Serializes whatever a wrapped resolver returned, builder or plain node. */
function serialize(root: unknown): PaneNode {
  const node = root as {serialize?: (options?: unknown) => PaneNode}
  return typeof node.serialize === 'function' ? node.serialize({path: []}) : (root as PaneNode)
}

/** The ids and types of a serialized list's items, in order. */
function itemsOf(root: unknown): {id: string; type: string}[] {
  const {items} = serialize(root) as unknown as {items?: {id: string; type: string}[]}
  return items ?? []
}

function resolveChild(root: unknown, itemId: string): unknown {
  const node = serialize(root)
  // A list's default child resolver looks the item up on its parent, so the
  // serialized node has to be passed back in the way real resolution does.
  const options = {parent: node} as RouterPaneSiblingContext
  return typeof node.child === 'function' ? node.child(itemId, options) : node.child
}

beforeEach(() => {
  resetInboxAvailability()
  resetWarnings()
})

describe('wrapStructure', () => {
  it('resolves the Inbox id without touching the list the developer wrote', () => {
    const posts = S.listItem().id('post').title('Posts')
    const wrapped = wrapStructure(() => S.list().id('content').items([posts]), resolveConfig())

    const root = wrapped(S, context)
    const home = resolveChild(root, INBOX_PANE_ID) as {getId: () => string}

    expect(home.getId()).toBe(INBOX_PANE_ID)
    // The whole point: no Inbox entry appears in the editor's list.
    expect(itemsOf(root).map((item) => item.id)).toEqual(['post'])
  })

  it('leaves every other id to the structure it wrapped', () => {
    const wrapped = wrapStructure(
      () =>
        S.list()
          .id('content')
          .items([
            S.listItem()
              .title('Posts')
              .id('post')
              .child(
                S.documentList().id('posts').apiVersion('2024-01-01').filter('_type == "post"'),
              ),
          ]),
      resolveConfig(),
    )

    // Serializing the list serializes its items too, so this is the developer's
    // own child arriving through the untouched default resolver.
    const child = resolveChild(wrapped(S, context), 'post') as {id: string; type: string}

    expect(child.type).toBe('documentList')
    expect(child.id).toBe('posts')
  })

  it('works when the root is not a list at all', () => {
    // The case that used to be unsupported: there is no list to add an item to,
    // but a child resolver does not need one.
    const wrapped = wrapStructure(
      () => S.documentList().id('posts').apiVersion('2024-01-01').filter('_type == "post"'),
      resolveConfig(),
    )

    const home = resolveChild(wrapped(S, context), INBOX_PANE_ID) as {getId: () => string}

    expect(home.getId()).toBe(INBOX_PANE_ID)
    expect(isInboxAvailable('structure')).toBe(true)
  })

  it('falls back to S.defaults() when no structure was configured', () => {
    const home = resolveChild(wrapStructure(undefined, resolveConfig())(S, context), INBOX_PANE_ID)

    expect((home as {getId: () => string}).getId()).toBe(INBOX_PANE_ID)
  })

  it('awaits an async structure resolver', async () => {
    const wrapped = wrapStructure(() => Promise.resolve(S.list().id('content')), resolveConfig())

    const home = resolveChild(await wrapped(S, context), INBOX_PANE_ID)

    expect((home as {getId: () => string}).getId()).toBe(INBOX_PANE_ID)
  })

  it('adds a visible list item above a divider when showInList is on', () => {
    const wrapped = wrapStructure(
      () =>
        S.list()
          .id('content')
          .items([S.listItem().id('post').title('Posts')]),
      resolveConfig({showInList: true}),
    )

    const items = itemsOf(wrapped(S, context))

    expect(items.map((item) => item.id)).toEqual([INBOX_PANE_ID, items[1].id, 'post'])
    expect(items[1].type).toBe('divider')
  })

  it('adds a visible list item above a divider when the resolver is async and showInList is on', async () => {
    const wrapped = wrapStructure(
      () =>
        Promise.resolve(
          S.list()
            .id('content')
            .items([S.listItem().id('post').title('Posts')]),
        ),
      resolveConfig({showInList: true}),
    )

    const items = itemsOf(await wrapped(S, context))

    expect(items.map((item) => item.id)).toEqual([INBOX_PANE_ID, items[1].id, 'post'])
    expect(items[1].type).toBe('divider')
  })

  it('reports availability only once the async resolver settles', async () => {
    const wrapped = wrapStructure(() => Promise.resolve(S.list().id('content')), resolveConfig())

    const result = wrapped(S, context)
    expect(isInboxAvailable('structure')).toBe(false)

    await result

    expect(isInboxAvailable('structure')).toBe(true)
  })

  it('warns but keeps the pane reachable when showInList has no list to add to', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const wrapped = wrapStructure(
      () => S.documentList().id('posts').apiVersion('2024-01-01').filter('_type == "post"'),
      resolveConfig({showInList: true}),
    )
    const home = resolveChild(wrapped(S, context), INBOX_PANE_ID)

    expect(warn.mock.calls.flat().join(' ')).toContain('showInList')
    expect((home as {getId: () => string}).getId()).toBe(INBOX_PANE_ID)
  })

  it('disables the redirect when the root cannot be extended', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // An observable root — the one shape there is no way to extend from here.
    const observable = {subscribe: () => ({unsubscribe: () => {}})}

    const result = wrapStructure(() => observable, resolveConfig())(S, context)

    expect(result).toBe(observable)
    expect(warn).toHaveBeenCalledOnce()
    expect(isInboxAvailable('structure')).toBe(false)
  })

  it('tracks availability per tool name', () => {
    wrapStructure(() => S.list().id('content'), resolveConfig({toolName: 'cars'}))(S, context)

    expect(isInboxAvailable('cars')).toBe(true)
    expect(isInboxAvailable('structure')).toBe(false)
  })

  it('builds a Inbox pane that carries its sources and refuses intents', () => {
    const wrapped = wrapStructure(() => S.list().id('content'), resolveConfig())
    const home = resolveChild(wrapped(S, context), INBOX_PANE_ID) as {
      getOptions: () => Record<string, unknown>
      spec: {canHandleIntent?: () => boolean}
    }

    expect(home.getOptions()).toEqual({sources: []})
    // A dashboard pane must never win the race to handle an `edit` intent.
    expect(home.spec.canHandleIntent?.()).toBe(false)
  })
})
