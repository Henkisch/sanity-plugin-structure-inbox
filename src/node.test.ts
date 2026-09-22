import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import * as nodeEntry from './node'

/**
 * The runtime exports of `sanity-plugin-structure-inbox/node`. Types can't be
 * enumerated at runtime, so the type-only half of the entry point is covered by
 * the source-text assertion below instead.
 */
const RUNTIME_EXPORTS = [
  'EDITOR_DOC_TYPES',
  'buildDigest',
  'findStaleEditorDocuments',
  'isDismissed',
  'isSnoozed',
  'parseAssessments',
  'parseDismissals',
  'parseSnoozes',
  'parseTodos',
] as const

const TYPE_EXPORTS = [
  'AssessmentState',
  'CachedAssessment',
  'DigestEditor',
  'DigestSource',
  'DismissalState',
  'EditorDigest',
  'EditorDocRef',
  'SnoozeState',
  'TodoItem',
  'TodosState',
] as const

/**
 * Every module reachable from `src/node.ts`, transitively. Short enough to
 * write out, and writing it out is the point: if it grows, someone should have
 * to think about what they added.
 */
const CLOSURE = [
  'node.ts',
  'digest.ts',
  'staleEditorDocs.ts',
  'store/assessments.ts',
  'store/dismissals.ts',
  'store/snoozes.ts',
  'store/todos.ts',
  'inbox/splitItems.ts',
  'inbox/types.ts',
]

const src = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('the ./node entry point', () => {
  it('exports exactly the runtime symbols it promises, and nothing more', () => {
    expect(Object.keys(nodeEntry).sort()).toEqual([...RUNTIME_EXPORTS].sort())
  })

  it('re-exports every type it promises', () => {
    const text = src('node.ts')

    for (const name of TYPE_EXPORTS) {
      expect(text, `./node should re-export the type ${name}`).toContain(`type ${name}`)
    }
  })

  // The point of this entry point is that its published type closure carries
  // none of `@sanity/client`'s ambient `declare global` blocks — `interface
  // File {}` in particular, which injects an empty global `File` into a consumer
  // compiled without the DOM lib. That is a property of `dist/`, which no unit
  // test can see; the manual grep in AGENTS.md is the real guard. What a unit
  // test *can* guard is the cause: the declaration bundler pulls a file's
  // ambient globals in whenever the file is reachable at all, so one
  // `@sanity/client` import anywhere in this closure — even type-only, even for
  // an unexported helper — would be enough.
  it('reaches no module that imports @sanity/client', () => {
    for (const file of CLOSURE) {
      const why = `${file} is in the ./node graph and must not import @sanity/client`

      expect(src(file), why).not.toContain("'@sanity/client'")
    }
  })

  it('keeps every module it re-exports exported from the main barrel too', () => {
    const barrel = src('index.ts')
    const text = src('node.ts')

    for (const module of [
      './store/assessments',
      './store/dismissals',
      './store/snoozes',
      './store/todos',
      './digest',
      './staleEditorDocs',
    ]) {
      // `./node` is additive: removing any of these from `.` would break every
      // existing consumer, which is exactly what this entry point exists to avoid.
      expect(barrel, `${module} must stay exported from the main barrel`).toContain(module)
      expect(text).toContain(module)
    }
  })
})
