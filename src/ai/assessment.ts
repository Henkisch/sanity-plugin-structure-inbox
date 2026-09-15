import {type InboxAssessment, type InboxItem} from '../inbox/types'

type Tone = NonNullable<InboxItem['tone']>

const TONES: readonly Tone[] = ['default', 'primary', 'positive', 'caution', 'critical']

function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value)
}

/** Thrown when a model answered but not in a shape `parseAssessment` can use — distinct from a transport failure, since only a transport failure is worth retrying. */
export class AssessmentUnavailableError extends Error {
  constructor() {
    super('AI answered, but not in a shape this could use as an assessment.')
    this.name = 'AssessmentUnavailableError'
  }
}

/**
 * Turns a parsed model answer into an assessment, or nothing.
 *
 * An unrecognised `tone` is dropped rather than mapped onto the nearest
 * allowed value: a model asked for one of five strings will eventually answer
 * "urgent", and guessing what it meant commits this plugin to guessing
 * consistently forever. The message is what carries the meaning; the colour
 * is a bonus that can be absent.
 */
export function parseAssessment(value: unknown): InboxAssessment | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('message' in value) || typeof value.message !== 'string') return null
  const message = value.message.trim()
  if (!message) return null

  const tone = 'tone' in value && typeof value.tone === 'string' && isTone(value.tone) ? value.tone : undefined

  return tone ? {message, tone} : {message}
}
