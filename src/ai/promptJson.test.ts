import {type SanityClient} from '@sanity/client'
import {describe, expect, it, vi} from 'vitest'

import {parseJsonResponse, promptJson} from './promptJson'

/**
 * A stub client whose `agent.action.prompt` is a plain `vi.fn()` — enough to
 * exercise `promptJson` itself, which every other test in this file (and
 * both integration suites that `vi.mock('../ai/promptJson')`) leaves
 * unexecuted. See plan 073: the parser was tested because it's pure and
 * easy; the function that actually spends the paid call was not.
 */
function stubClient(prompt: (args: unknown) => Promise<string>): SanityClient {
  return {agent: {action: {prompt}}} as unknown as SanityClient
}

describe('parseJsonResponse', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonResponse<{a: number}>('{"a": 1}')).toEqual({a: 1})
  })

  it('parses JSON inside ```json fences', () => {
    const raw = '```json\n{"a": 1}\n```'
    expect(parseJsonResponse<{a: number}>(raw)).toEqual({a: 1})
  })

  it('parses JSON preceded by a sentence of prose', () => {
    const raw = 'Here is the answer:\n{"a": 1}'
    expect(parseJsonResponse<{a: number}>(raw)).toEqual({a: 1})
  })

  it('returns null for pure prose with no JSON', () => {
    expect(parseJsonResponse('This document looks ready to publish.')).toBeNull()
  })

  it('returns null for truncated/malformed JSON, without throwing', () => {
    expect(parseJsonResponse('{"a": 1,')).toBeNull()
  })

  it('parses a JSON array answer', () => {
    expect(parseJsonResponse<number[]>('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('parses correctly when a string value inside the JSON contains a closing brace', () => {
    const raw = 'Sure — {"reason": "looks unfinished (missing a hero image}"}'
    expect(parseJsonResponse<{reason: string}>(raw)).toEqual({
      reason: 'looks unfinished (missing a hero image}',
    })
  })

  it('skips a decoy brace that names the keys in prose and parses the real payload after it', () => {
    const raw =
      'I\'ll return a JSON object with the keys {id, label, reason}: {"id": "abc", "label": "x", "reason": "y"}'
    expect(parseJsonResponse<{id: string; label: string; reason: string}>(raw)).toEqual({
      id: 'abc',
      label: 'x',
      reason: 'y',
    })
  })

  it('returns the first candidate that parses, even when a later one also would (first-valid-candidate wins)', () => {
    const raw = 'First guess: {"id": "wrong"}. Actual answer: {"id": "right"}'
    expect(parseJsonResponse<{id: string}>(raw)).toEqual({id: 'wrong'})
  })

  it('returns null for a pure-prose answer with no candidate braces at all', () => {
    const raw = 'The assessment could not be completed for this document.'
    expect(parseJsonResponse(raw)).toBeNull()
  })

  it('skips a candidate that never closes and parses the valid JSON that follows it', () => {
    const raw = 'Note: [1, 2, 3 and then the real payload is {"ok": true}'
    expect(parseJsonResponse<{ok: boolean}>(raw)).toEqual({ok: true})
  })

  it('gives up past the candidate cap rather than scanning indefinitely for a valid payload', () => {
    const raw = '{'.repeat(25) + '"ok": true}'
    expect(parseJsonResponse<{ok: boolean}>(raw)).toBeNull()
  })

  it('still parses an array answer when it is not the first candidate', () => {
    const raw = 'Guess: {oops} then the list is [1, 2, 3]'
    expect(parseJsonResponse<number[]>(raw)).toEqual([1, 2, 3])
  })
})

describe('promptJson', () => {
  it('passes the instruction, instructionParams, and spread extra through to agent.action.prompt verbatim', async () => {
    const prompt = vi.fn().mockResolvedValue('{"until": "2026-06-01T00:00:00.000Z"}')
    const client = stubClient(prompt)

    await promptJson(
      client,
      'Suggest a snooze date',
      {document: {type: 'document', documentId: 'doc-1'}},
      {localeSettings: {locale: 'sv-SE', timeZone: 'Europe/Stockholm'}},
    )

    // A dropped `localeSettings` is what makes every snooze suggestion
    // resolve in UTC — see `unpublishedDrafts.ts:327` and plan 073's own
    // "Current state" notes.
    expect(prompt).toHaveBeenCalledWith({
      instruction: 'Suggest a snooze date',
      instructionParams: {document: {type: 'document', documentId: 'doc-1'}},
      localeSettings: {locale: 'sv-SE', timeZone: 'Europe/Stockholm'},
    })
  })

  it('resolves null for a prose (non-JSON) answer, rather than throwing', async () => {
    const prompt = vi.fn().mockResolvedValue('I could not find anything to report here.')
    const client = stubClient(prompt)

    await expect(promptJson(client, 'Assess this document')).resolves.toBeNull()
  })

  it('rejects when agent.action.prompt itself rejects — a transport failure is not swallowed to null', async () => {
    const prompt = vi.fn().mockRejectedValue(new Error('Agent Actions request failed'))
    const client = stubClient(prompt)

    // This is the documented contract (`promptJson.ts:83-85` at authoring
    // time): a malformed *answer* becomes `null`, a failed *request* still
    // rejects, so the caller — and ultimately the editor — sees an error
    // rather than silence.
    await expect(promptJson(client, 'Assess this document')).rejects.toThrow(
      'Agent Actions request failed',
    )
  })
})
