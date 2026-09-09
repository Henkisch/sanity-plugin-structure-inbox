import {
  createStructureBuilder,
  type ListBuilder,
  type StructureBuilder,
  type StructureResolverContext,
} from 'sanity/structure'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {HOME_PANE_ID} from '../constants'
import {resetWarnings} from '../warnOnce'
import {isHomeAvailable, resetHomeAvailability} from './homeAvailability'
import {resolveConfig} from './resolveConfig'
import {wrapStructure} from './wrapStructure'

/**
 * A real `StructureBuilder`, so these tests exercise the actual `ListBuilder`
 * that `wrapStructure` branches on rather than a stub that agrees with it.
 *
 * `createStructureBuilder` wants a Studio `Source`, which is far too large to
 * construct here. Building and inspecting nodes only reaches for three pieces
 * of it — the schema, i18n, and new-document options — and most of that only
 * when a node is serialized. Nothing here serializes, so those three stubs are
 * the whole of the fixture.
 */
const S: StructureBuilder = createStructureBuilder({
  source: {
    schema: {get: () => undefined, getTypeNames: () => []},
    i18n: {t: (key: string) => key},
    document: {resolveNewDocumentOptions: () => []},
  },
} as never)

const context = {} as StructureResolverContext

/** Reads a node's id without caring which kind of builder it is. */
function idOf(node: unknown): string | undefined {
  const id: unknown = (node as {getId?: () => unknown}).getId?.()
  return typeof id === 'string' ? id : undefined
}

function isDivider(node: unknown): boolean {
  const type: unknown = (node as {spec?: {type?: unknown}})?.spec?.type
  return type === 'divider'
}

beforeEach(() => {
  resetHomeAvailability()
  resetWarnings()
})

describe('wrapStructure', () => {
  it('puts the Home item first, above a divider, keeping the original items', () => {
    const existing = S.listItem().id('post').title('Posts')
    const wrapped = wrapStructure(() => S.list().id('content').items([existing]), resolveConfig())

    const items = (wrapped(S, context) as ListBuilder).getItems() ?? []

    expect(items).toHaveLength(3)
    expect(idOf(items[0])).toBe(HOME_PANE_ID)
    expect(isDivider(items[1])).toBe(true)
    expect(items[2]).toBe(existing)
  })

  it('falls back to S.defaults() when no structure was configured', () => {
    const wrapped = wrapStructure(undefined, resolveConfig())

    const items = (wrapped(S, context) as ListBuilder).getItems() ?? []

    expect(idOf(items[0])).toBe(HOME_PANE_ID)
    expect(isDivider(items[1])).toBe(true)
  })

  it('reports the tool as available once injection succeeds', () => {
    wrapStructure(() => S.list().id('content'), resolveConfig())(S, context)

    expect(isHomeAvailable('structure')).toBe(true)
  })

  it('warns and leaves the structure untouched when the root is not a list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A document list is the shape this degrades on: real structures written as
    // `S.documentTypeList('post')` have no root list to add an item to.
    const notAList = S.documentList().id('posts').filter('_type == "post"')

    const result = wrapStructure(() => notAList, resolveConfig())(S, context)

    expect(result).toBe(notAList)
    expect(warn).toHaveBeenCalledOnce()
    // The redirect has to stay off, or editors land on a pane that cannot resolve.
    expect(isHomeAvailable('structure')).toBe(false)
  })

  it('leaves the structure untouched when autoInject is off, but keeps the pane reachable', () => {
    const base = S.list().id('content')

    const result = wrapStructure(() => base, resolveConfig({autoInject: false}))(S, context)

    expect(result).toBe(base)
    // The developer places `homeListItem` themselves, so the URL still resolves.
    expect(isHomeAvailable('structure')).toBe(true)
  })

  it('tracks availability per tool name', () => {
    wrapStructure(() => S.list().id('content'), resolveConfig({toolName: 'cars'}))(S, context)

    expect(isHomeAvailable('cars')).toBe(true)
    expect(isHomeAvailable('structure')).toBe(false)
  })

  it('builds a Home item that opens the Home pane and refuses intents', () => {
    const items = (wrapStructure(undefined, resolveConfig())(S, context) as ListBuilder).getItems()
    const home = items?.[0] as {getChild?: () => unknown}
    const child = home.getChild?.() as {
      getId: () => string
      getOptions: () => Record<string, unknown>
      spec: {canHandleIntent?: (...args: never[]) => boolean}
    }

    expect(child.getId()).toBe(HOME_PANE_ID)
    expect(child.getOptions()).toEqual({widgets: []})
    // A dashboard pane must never win the race to handle an `edit` intent.
    expect(child.spec.canHandleIntent?.()).toBe(false)
  })
})
