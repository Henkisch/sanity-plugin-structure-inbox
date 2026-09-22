import {describe, expect, it} from 'vitest'

import {DEFAULT_TOOL_NAME} from '../constants'
import {resolveConfig} from './resolveConfig'

/**
 * The plugin-level cost defaults, untested until now (`Inbox.test.tsx`'s own
 * prop-default tests cover the *component*, not this function — see plan
 * 073). `ask` defaulting to `false` is the one that matters most: `ask` is
 * the only one of the three that bills the integrator on every click rather
 * than once per background refresh, so a regression that flipped its
 * default would turn every fresh install into an opt-out cost surface
 * instead of an opt-in one.
 */
describe('resolveConfig — AI cost defaults', () => {
  it('defaults `ask` to false — the one default that bills per click if it silently flipped', () => {
    expect(resolveConfig({}).ask).toBe(false)
    expect(resolveConfig().ask).toBe(false)
  })

  it('respects an explicit `ask: true`', () => {
    expect(resolveConfig({ask: true}).ask).toBe(true)
  })

  it('defaults `summarize` to true', () => {
    expect(resolveConfig({}).summarize).toBe(true)
  })

  it('respects an explicit `summarize: false`', () => {
    expect(resolveConfig({summarize: false}).summarize).toBe(false)
  })

  it('defaults `suggestTodos` to true', () => {
    expect(resolveConfig({}).suggestTodos).toBe(true)
  })

  it('respects an explicit `suggestTodos: false`', () => {
    expect(resolveConfig({suggestTodos: false}).suggestTodos).toBe(false)
  })

  it('leaves the other defaults untouched, for context', () => {
    const resolved = resolveConfig({})
    expect(resolved.toolName).toBe(DEFAULT_TOOL_NAME)
    expect(resolved.redirectOnLanding).toBe(true)
    expect(resolved.sources).toEqual([])
  })
})
