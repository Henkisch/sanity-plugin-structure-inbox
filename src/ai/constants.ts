/**
 * API version Agent Actions are served on.
 *
 * Deliberately not `API_VERSION` (`src/constants.ts`), and deliberately not
 * a dated pin: Sanity serves Agent Actions only on the experimental `vX`
 * version, which by definition can change under us. That instability is
 * exactly why it is confined to this module and reached through
 * `useAgentClient` — the rest of the plugin keeps its dated pin, and an
 * `assess` that stops working costs one optional button rather than every
 * query in the pane.
 *
 * @internal
 */
export const AGENT_API_VERSION = 'vX'
