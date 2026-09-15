import {type SanityClient} from '@sanity/client'

/**
 * Finds the first balanced `{...}` or `[...]` in `raw` and returns that
 * substring, or `null` if none closes. Tracks string literals (with escape
 * handling) so a `}` inside a JSON string value never prematurely ends the
 * match — a naive last-brace search would get this wrong the moment a
 * string value itself contains one.
 */
function extractBalanced(raw: string): string | null {
  const start = raw.search(/[{[]/)
  if (start === -1) return null

  const open = raw[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === open) {
      depth += 1
    } else if (char === close) {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }

  return null
}

/**
 * Pulls a JSON value out of a model's answer.
 *
 * Models wrap JSON in ```json fences, prefix it with a sentence, or return
 * prose when the instruction did not land. All three are normal, none is an
 * error worth surfacing to an editor, and every one of them must end up as
 * `null` rather than a throw: a malformed answer costs one row's optional
 * extra, never the row.
 *
 * Extracts the outermost balanced `{...}` or `[...]` rather than parsing the
 * whole string, so a leading "Here you go:" or a trailing code fence does not
 * defeat it.
 */
// eslint-disable-next-line no-unnecessary-type-parameters -- `T` is the caller's own expected shape for the parsed value; there is nothing else in this function's own signature it could be inferred from, the same as `JSON.parse`'s own generic callers already expect to supply it explicitly.
export function parseJsonResponse<T>(raw: string): T | null {
  const candidate = extractBalanced(raw)
  if (candidate === null) return null

  try {
    // eslint-disable-next-line no-unsafe-type-assertion -- `JSON.parse` returns `any` by construction; `T` is the caller's own asserted shape for whatever the model answered with, which nothing here can verify beyond "it parsed as JSON."
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}

/**
 * One Agent Actions `prompt` call that expects JSON back.
 *
 * Deliberately does not set `format: 'json'` — that option's return type
 * loses the conditional overload `agent.action.prompt` otherwise resolves to
 * once a `withConfig`-scoped client is involved (the same cross-type
 * mismatch every inline call site before this module worked around with its
 * own `as unknown as X` cast). Asking for JSON in the instruction text
 * instead keeps this on the plain `Promise<string>` overload — no cast
 * anywhere in this file — and `parseJsonResponse` is exactly the defensive
 * layer that makes a plain-text answer safe to treat as JSON regardless.
 *
 * Returns `null` on an unusable answer rather than throwing, so a caller can
 * treat "the model did not cooperate" the same way it treats "the model is
 * not configured" — as an absent extra. A *transport* failure still rejects:
 * that one is worth a caught error and a message.
 */
export async function promptJson<T>(
  client: SanityClient,
  instruction: string,
  instructionParams?: Record<string, unknown>,
): Promise<T | null> {
  const raw = await client.agent.action.prompt({
    instruction,
    // eslint-disable-next-line no-unsafe-type-assertion -- `@sanity/client`'s own `AgentActionParams` shape (string | document | groq | field param, per key) is stricter than this wrapper's deliberately-plain `Record<string, unknown>` — every real caller already satisfies it structurally (a document/groq/field param object, or a plain string), so this loosens the type at the boundary rather than making every caller import an agent-specific type for no behavioral difference.
    instructionParams: instructionParams as Parameters<typeof client.agent.action.prompt>[0]['instructionParams'],
  })
  return parseJsonResponse<T>(raw)
}
