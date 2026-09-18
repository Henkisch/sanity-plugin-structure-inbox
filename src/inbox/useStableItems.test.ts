import {renderHook} from '@testing-library/react'
import {describe, expect, it} from 'vitest'

import {type InboxItem} from './types'
import {sameItems, useStableItems} from './useStableItems'

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
