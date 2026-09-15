import {type SanityClient} from '@sanity/client'
import {useMemo} from 'react'
import {useClient} from 'sanity'

import {API_VERSION} from '../constants'
import {warnOnce} from '../warnOnce'
import {AGENT_API_VERSION} from './constants'

export interface UseAgentClientOptions {
  /** Set `false` to skip the availability check and always return `undefined` — the caller's own opt-out, not a broken Studio. */
  enabled?: boolean
}

/**
 * A client scoped to Agent Actions' own experimental API version, or
 * `undefined` when Agent Actions are unavailable.
 *
 * `undefined` rather than a client that will fail at call time: a source can
 * then omit `assess`/`proposeFix`/etc. entirely, so an editor sees no AI
 * button instead of a button that always errors. Same containment posture
 * `capability.ts`'s `optionalHook` already takes for a `@beta`/`@internal`
 * Sanity export — applied here to an experimental *client* rather than an
 * experimental *hook*.
 *
 * Calls `useClient` unconditionally (rules of hooks) regardless of `enabled`,
 * so a caller can toggle it without restructuring its own hook calls.
 *
 * @internal
 */
export function useAgentClient(options: UseAgentClientOptions = {}): SanityClient | undefined {
  const {enabled = true} = options
  const client = useClient({apiVersion: API_VERSION})

  return useMemo(() => {
    if (!enabled) return undefined

    // Defensive, not merely defensive-in-principle: `.agent` is typed as
    // always present in this project's own `@sanity/client` version, but a
    // consumer's Studio can resolve a different one transitively. A missing
    // method here degrades every AI feature to absent, never a throw.
    if (typeof client.agent?.action?.prompt !== 'function') {
      warnOnce('Agent Actions are unavailable in this Studio (client.agent.action.prompt is missing) — AI features are hidden.')
      return undefined
    }

    return client.withConfig({apiVersion: AGENT_API_VERSION})
  }, [client, enabled])
}
