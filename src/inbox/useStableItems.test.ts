import {renderHook} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {resetWarnings} from '../warnOnce'
import {type InboxItem} from './types'
import {sameItems, useStableItems} from './useStableItems'

// `warnOnce` dedupes by message for the process lifetime, so the freeze
// test's assertion on `console.warn` would only pass once per run without
// this — see `wrapStructure.test.ts` for the same convention.
beforeEach(() => {
  resetWarnings()
})

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'doc-1',
    title: 'A draft',
    subtitle: 'Post',
    timestamp: '2026-09-18T08:00:00.000Z',
    changedAt: '2026-09-18T08:00:00.000Z',
    intent: {type: 'edit', params: {id: 'doc-1', type: 'post'}},
    ...overrides,
  }
}

function IconA() {
  return null
}

function IconB() {
  return null
}

describe('sameItems', () => {
  it('sees identical content built as brand-new objects as unchanged', () => {
    expect(sameItems([item()], [item()])).toBe(true)
  })

  it('sees a changed field as changed', () => {
    expect(sameItems([item()], [item({title: 'A different draft'})])).toBe(false)
    expect(sameItems([item()], [item({changedAt: '2026-09-18T09:00:00.000Z'})])).toBe(false)
    expect(sameItems([item()], [item({cleared: true})])).toBe(false)
  })

  // The one nested object an `InboxItem` actually carries — compared field by
  // field, because a source building items fresh builds this fresh too.
  it('looks inside `intent`', () => {
    expect(sameItems([item()], [item({intent: {type: 'edit', params: {id: 'doc-1', type: 'post'}}})])).toBe(
      true,
    )
    expect(sameItems([item()], [item({intent: {type: 'edit', params: {id: 'doc-2', type: 'post'}}})])).toBe(
      false,
    )
  })

  // `icon` is a component, so it stays on `===`: two different components are
  // a real change, and nothing here could tell two closures apart anyway.
  it('compares an icon by identity', () => {
    expect(sameItems([item({icon: IconA})], [item({icon: IconA})])).toBe(true)
    expect(sameItems([item({icon: IconA})], [item({icon: IconB})])).toBe(false)
  })

  it('sees a field appearing or disappearing as changed', () => {
    expect(sameItems([item()], [item({tone: 'critical'})])).toBe(false)
    expect(sameItems([item({tone: 'critical'})], [item()])).toBe(false)
  })

  it('sees a different length or order as changed', () => {
    expect(sameItems([item()], [])).toBe(false)
    expect(sameItems([item({id: 'a'}), item({id: 'b'})], [item({id: 'b'}), item({id: 'a'})])).toBe(false)
  })

  it('treats two empty lists as unchanged', () => {
    expect(sameItems([], [])).toBe(true)
  })
})

describe('useStableItems', () => {
  it('hands back the same array while the content is unchanged', () => {
    const {result, rerender} = renderHook(({items}) => useStableItems(items), {
      initialProps: {items: [item()]},
    })

    const first = result.current
    rerender({items: [item()]})

    expect(result.current).toBe(first)
  })

  it('adopts the new array once the content really changes', () => {
    const {result, rerender} = renderHook(({items}) => useStableItems(items), {
      initialProps: {items: [item()]},
    })

    const first = result.current
    const changed = [item({title: 'Renamed'})]
    rerender({items: changed})

    expect(result.current).not.toBe(first)
    expect(result.current).toEqual(changed)
  })
})

describe('an item value allocated fresh every render', () => {
  // `sameValue` falls back to `===` for anything that is not a primitive, a
  // plain object or an array, so an item carrying a freshly-allocated function
  // compares unequal *forever* — unless, like `icon`, it is compared by name
  // instead (see below). Without a bound, this hook's own render-phase
  // `setStable` then runs on every render — a loop upstream of every other
  // guard in the pane. `icon?: ComponentType` is exactly that shape and is
  // documented public API, so this is reachable, not theoretical: it shipped in
  // 1.0.4 and took a Studio down.
  it('keeps updating, because two inline icons compare equal by name', () => {
    const {result, rerender} = renderHook(
      ({n}) => useStableItems([item({icon: () => null, title: `v${n}`})], 'churningIcon'),
      {initialProps: {n: 0}},
    )

    // Well past MAX_CONSECUTIVE_ADOPTIONS, and each rerender commits, so the
    // reset effect runs between them — this is the *legitimate* case and must
    // keep updating.
    for (let n = 1; n <= 8; n++) rerender({n})

    expect(result.current[0]?.title).toBe('v8')
  })

  // The case above no longer reaches the freeze at all — `sameValue` compares
  // two functions by name (`useStableItems.ts:39-41`), added specifically so a
  // per-render inline `icon` stops freezing a source. What still falls through
  // to `sameValue`'s unconditional `return false` is a `Date`, a `Map`, a
  // `Set`, or a class instance — none of which `InboxItem` (`./types.ts`) has
  // a field typed to accept directly (its only non-primitive fields are
  // `intent`/`assignee`, both compared structurally, and `icon`, compared by
  // name). So this test reaches the same permanent-inequality fallthrough
  // through a function whose *name* is unique on every single invocation
  // (including the internal render-phase retries `setStable` triggers within
  // one external rerender, not just once per rerender call) — that is exactly
  // as unrepresentable to `sameValue` as a fresh `Date` would be, and for the
  // same reason: nothing here can ever consider two such values equal.
  it('freezes after MAX_CONSECUTIVE_ADOPTIONS rather than looping forever', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let uniqueIconCount = 0
    function freshlyNamedIcon() {
      uniqueIconCount += 1
      const name = `Icon${uniqueIconCount}`
      // Computed property name so the returned function's own `.name` is
      // unique per call — an inline `() => null` would infer the name
      // `'icon'` every time (from the property key it's assigned to) and
      // settle immediately, the same as the legitimate case above.
      return {[name]: () => null}[name]
    }

    const {result, rerender} = renderHook(
      ({n}) => useStableItems([item({title: `v${n}`, icon: freshlyNamedIcon()})], 'churningFreeze'),
      {initialProps: {n: 0}},
    )

    for (let n = 1; n <= 3; n++) rerender({n})

    const frozen = result.current
    // A further rerender must not un-freeze it, and must not warn again —
    // `warnOnce` already fired, and the freeze branch never touches
    // `adoptions.current`, so it stays latched.
    rerender({n: 999})

    expect(result.current).toBe(frozen)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('never compare equal')

    warn.mockRestore()
  })
})
