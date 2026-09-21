import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {resetWarnings} from '../warnOnce'
import {AGENT_API_VERSION} from './constants'
import {useAgentClient} from './useAgentClient'

/**
 * The single gate every paid Agent Actions call in this plugin goes
 * through. Untested until now — see plan 073's own reasoning: everything
 * downstream of this either gets a real client or `undefined`, and a
 * regression here would either disable every AI feature silently or hand a
 * source a client that fails at call time.
 */

const {useClientMock} = vi.hoisted(() => ({useClientMock: vi.fn()}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
  }
})

function fakeClient(hasPrompt: boolean) {
  const withConfig = vi.fn()
  const client = {
    withConfig,
  } as unknown as SanityClient

  withConfig.mockReturnValue(client)

  if (hasPrompt) {
    Object.assign(client, {agent: {action: {prompt: vi.fn()}}})
  }

  return {client, withConfig}
}

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
  resetWarnings()
})

describe('useAgentClient', () => {
  it('returns undefined when disabled, without even checking the client', () => {
    const {client} = fakeClient(true)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useAgentClient({enabled: false}))
    expect(result.current).toBeUndefined()
  })

  it('returns a client scoped to the Agent Actions API version when enabled and prompt is available', () => {
    const {client, withConfig} = fakeClient(true)
    useClientMock.mockReturnValue(client)

    const {result} = renderHook(() => useAgentClient({enabled: true}))

    expect(withConfig).toHaveBeenCalledWith({apiVersion: AGENT_API_VERSION})
    expect(result.current).toBe(client)
  })

  it('returns undefined and warns once when client.agent.action.prompt is not a function', () => {
    const {client} = fakeClient(false)
    useClientMock.mockReturnValue(client)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const {result} = renderHook(() => useAgentClient({enabled: true}))

    expect(result.current).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('Agent Actions are unavailable')

    warnSpy.mockRestore()
  })
})
