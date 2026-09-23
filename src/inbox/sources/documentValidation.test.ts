import {type SanityClient} from '@sanity/client'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  collectReferenceIds,
  documentValidation,
  firstErrorPath,
  describeValidationPath,
  formatValidationPath,
  toFocusPath,
  runValidation,
  validateUntilSettled,
  summarizeErrors,
} from './documentValidation'

// `runValidation` is a plain async function, not a hook — see its own doc
// comment — so it can be exercised directly with a stub client and a mocked
// `@sanity/validation`, the same reasoning `openTasks.test.ts`'s
// `dueSubtitleKey` comment gives for why this file's own tests avoid
// rendering `useItems()`.
const {validateDocumentMock} = vi.hoisted(() => ({validateDocumentMock: vi.fn()}))

vi.mock('@sanity/validation', () => ({
  validateDocument: validateDocumentMock,
}))

// Plan 040: the factory's own `title` is now a translation key by default —
// no need to render `useItems()` (or mock its `useClient`/`useSchema`
// context) to prove this, since `title` flows straight from the option into
// the returned `InboxSource` with no hooks in between.
describe('documentValidation title', () => {
  it('defaults to a translation key, not a bare English string', () => {
    expect(documentValidation().title).toBe('source.documentValidation.defaultTitle')
  })

  it('keeps a custom title exactly as given — never treated as a translation key', () => {
    expect(documentValidation({title: 'My Custom Drafts'}).title).toBe('My Custom Drafts')
  })
})

describe('collectReferenceIds', () => {
  it('finds a top-level reference', () => {
    const ids = new Set<string>()
    collectReferenceIds({author: {_type: 'reference', _ref: 'author-1'}}, ids)
    expect(ids).toEqual(new Set(['author-1']))
  })

  it('finds a reference nested inside an array', () => {
    const ids = new Set<string>()
    collectReferenceIds({tags: [{_type: 'reference', _ref: 'tag-1'}, {_type: 'reference', _ref: 'tag-2'}]}, ids)
    expect(ids).toEqual(new Set(['tag-1', 'tag-2']))
  })

  it('finds an image asset reference', () => {
    const ids = new Set<string>()
    collectReferenceIds({hero: {_type: 'image', asset: {_type: 'reference', _ref: 'image-abc'}}}, ids)
    expect(ids).toEqual(new Set(['image-abc']))
  })

  it('dedupes the same reference found twice', () => {
    const ids = new Set<string>()
    collectReferenceIds(
      {a: {_type: 'reference', _ref: 'x'}, b: {_type: 'reference', _ref: 'x'}},
      ids,
    )
    expect(ids).toEqual(new Set(['x']))
  })

  it('does nothing for a document with no references', () => {
    const ids = new Set<string>()
    collectReferenceIds({title: 'Plain doc', count: 3}, ids)
    expect(ids.size).toBe(0)
  })
})

describe('formatValidationPath', () => {
  it('renders a plain field path', () => {
    expect(formatValidationPath(['title'])).toBe('title')
  })

  it('renders a nested field path', () => {
    expect(formatValidationPath(['hero', 'alt'])).toBe('hero.alt')
  })

  it('renders a keyed array item', () => {
    expect(formatValidationPath(['items', {_key: 'abc123'}, 'name'])).toBe('items.[abc123].name')
  })

  it('renders an empty path as an empty string', () => {
    expect(formatValidationPath([])).toBe('')
  })
})

describe('summarizeErrors', () => {
  it('returns null when the result passed', () => {
    expect(summarizeErrors({status: 'passed', markers: []})).toBeNull()
  })

  it('returns null when only warnings are present, never an error', () => {
    expect(
      summarizeErrors({
        status: 'failed',
        markers: [{level: 'warning', message: 'Consider adding a description', path: ['description']}],
      }),
    ).toBeNull()
  })

  it('summarizes one error', () => {
    expect(
      summarizeErrors({status: 'failed', markers: [{level: 'error', message: 'Required', path: ['title']}]}),
    ).toBe('title: Required')
  })

  it('joins several errors, ignoring any warnings mixed in', () => {
    expect(
      summarizeErrors({
        status: 'failed',
        markers: [
          {level: 'error', message: 'Required', path: ['title']},
          {level: 'warning', message: 'Consider a shorter title', path: ['title']},
          {level: 'error', message: 'Required', path: ['hero', 'alt']},
        ],
      }),
    ).toBe('title: Required · hero.alt: Required')
  })
})

// Plan 069: the existence prefetch (`client.fetch`) and the validation pass
// (`mapWithConcurrency`) were both awaited with no `try`/`catch`, inside a
// `void run()` with no `.catch`. A rejection anywhere left `results` as it
// was — empty on a cold pane — so the source emitted zero rows while
// `loading` was already `false` and `error` was `undefined`: a confident
// "no validation problems" card when drafts were really failing, or when the
// run itself never completed.
describe('runValidation', () => {
  afterEach(() => {
    validateDocumentMock.mockReset()
  })

  function stubClient(fetchImpl: () => Promise<string[]>) {
    return {fetch: vi.fn(fetchImpl)} as unknown as SanityClient
  }

  it('a rejecting existence prefetch: non-reference rules still evaluate, never an empty result with no error', async () => {
    // A reference field forces `runValidation` to attempt the prefetch at
    // all — with none, `referenceIds.size` would be 0 and the prefetch would
    // never run.
    const draft = {
      _id: 'drafts.doc-1',
      _type: 'post',
      author: {_type: 'reference', _ref: 'author-1'},
    }
    const client = stubClient(() => Promise.reject(new Error('network down')))

    // Stands in for a non-reference rule (e.g. a missing required title)
    // failing regardless of whether reference existence could be proven —
    // option (a): an unproven prefetch degrades to `getDocumentExists:
    // undefined`, not to "skip every rule".
    validateDocumentMock.mockImplementation(
      async ({getDocumentExists}: {getDocumentExists?: (o: {id: string}) => Promise<boolean>}) => {
        expect(getDocumentExists).toBeUndefined()
        return {status: 'failed', markers: [{level: 'error', message: 'Required', path: ['title']}]}
      },
    )

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const run = await runValidation(client, {} as never, null, [draft])

    // The bug this plan fixes, stated as its own assertion: this combination
    // reads as "no validation problems" and must never be what a failed
    // prefetch produces.
    expect(run).not.toEqual({results: new Map(), error: undefined})
    expect(run.error).toBeUndefined()
    expect(run.results.get('drafts.doc-1')?.status).toBe('failed')

    errorSpy.mockRestore()
  })

  it('logs a rejecting prefetch via console.error with the plugin prefix', async () => {
    const client = stubClient(() => Promise.reject(new Error('network down')))
    validateDocumentMock.mockResolvedValue({status: 'passed', markers: []})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runValidation(
      client,
      {} as never,
      null,
      [{_id: 'drafts.doc-1', _type: 'post', author: {_type: 'reference', _ref: 'author-1'}}],
    )

    expect(errorSpy).toHaveBeenCalledWith(
      '[sanity-plugin-structure-inbox] could not prefetch reference existence',
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })

  it('a validation pass that rejects outside withTimeout (a synchronous throw) is caught and surfaced, not left unhandled', async () => {
    // No reference fields — the prefetch resolves trivially, isolating this
    // test to the second unprotected await: `mapWithConcurrency`.
    const draft = {_id: 'drafts.doc-1', _type: 'post'}
    const client = stubClient(() => Promise.resolve([]))

    // A plain (non-async) throw here happens while `validateDocument({...})`
    // is still being evaluated as withTimeout's argument — before
    // `withTimeout` ever receives a promise to protect — so this is the
    // "non-timeout-able" rejection `mapWithConcurrency` itself surfaces.
    validateDocumentMock.mockImplementation(() => {
      throw new Error('validator crashed')
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const run = await runValidation(client, {} as never, null, [draft])

    expect(run.results.size).toBe(0)
    expect(run.error).toBeInstanceOf(Error)
    expect(run.error?.message).toBe('validator crashed')
    expect(errorSpy).toHaveBeenCalledWith(
      '[sanity-plugin-structure-inbox] validation run failed',
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })

  it('happy path: a resolving prefetch feeds a real Set to getDocumentExists', async () => {
    const client = stubClient(() => Promise.resolve(['author-1']))
    validateDocumentMock.mockImplementation(
      async ({getDocumentExists}: {getDocumentExists?: (o: {id: string}) => Promise<boolean>}) => {
        const exists = await getDocumentExists?.({id: 'author-1'})
        return {status: exists ? 'passed' : 'failed', markers: []}
      },
    )

    const run = await runValidation(
      client,
      {} as never,
      null,
      [{_id: 'drafts.doc-1', _type: 'post', author: {_type: 'reference', _ref: 'author-1'}}],
    )

    expect(run.error).toBeUndefined()
    expect(run.results.get('drafts.doc-1')?.status).toBe('passed')
  })
})

describe('toFocusPath', () => {
  it('renders a plain field path', () => {
    expect(toFocusPath(['title'])).toBe('title')
    expect(toFocusPath(['hero', 'alt'])).toBe('hero.alt')
  })

  it('renders an array item by its _key, the way the Studio expects', () => {
    // The whole reason this is separate from `formatValidationPath`, which
    // renders the same segment as the display-only `[abc123]`.
    expect(toFocusPath(['items', {_key: 'abc123'}, 'name'])).toBe('items[_key=="abc123"].name')
    expect(formatValidationPath(['items', {_key: 'abc123'}, 'name'])).toBe('items.[abc123].name')
  })

  it('renders a numeric index', () => {
    expect(toFocusPath(['items', 2, 'name'])).toBe('items[2].name')
  })

  it('declines a document-level error, which has no field to focus', () => {
    expect(toFocusPath([])).toBeNull()
  })

  it('declines anything it cannot render exactly, rather than guessing', () => {
    // A wrong path opens the document and focuses nothing, which reads as the
    // link being broken — worse than sending no path at all.
    expect(toFocusPath([{weird: true}])).toBeNull()
    expect(toFocusPath(['items', {_key: 42}])).toBeNull()
    expect(toFocusPath([0, 'name'])).toBeNull()
  })
})

describe('firstErrorPath', () => {
  const marker = (level: string, path: unknown[]) => ({level, path, message: 'nope'})

  it('picks the first error that names a field', () => {
    expect(
      firstErrorPath({
        markers: [marker('error', ['title']), marker('error', ['body'])],
      } as never),
    ).toBe('title')
  })

  it('skips warnings, which are not what the row is reporting', () => {
    expect(
      firstErrorPath({
        markers: [marker('warning', ['ignored']), marker('error', ['title'])],
      } as never),
    ).toBe('title')
  })

  it('skips a document-level error to find one that can actually be focused', () => {
    expect(
      firstErrorPath({
        markers: [marker('error', []), marker('error', ['slug', 'current'])],
      } as never),
    ).toBe('slug.current')
  })

  it('returns null when nothing has a focusable path', () => {
    expect(firstErrorPath({markers: [marker('error', [])]} as never)).toBeNull()
    expect(firstErrorPath({markers: []} as never)).toBeNull()
  })
})

describe('validateUntilSettled', () => {
  const draftA = {_id: 'drafts.a'}
  const draftB = {_id: 'drafts.b'}
  const failed = {status: 'failed', markers: []} as never
  const timedOut = {status: 'notEvaluated', markers: []} as never

  it('retries only the drafts that timed out, with the longer timeout, and merges the result', async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({results: new Map([['drafts.a', failed], ['drafts.b', timedOut]])})
      .mockResolvedValueOnce({results: new Map([['drafts.b', failed]])})
    const updates: Map<string, unknown>[] = []

    const left = await validateUntilSettled(
      [draftA, draftB],
      validate,
      (run) => updates.push(run.results),
      () => false,
      [30_000],
    )

    expect(validate).toHaveBeenNthCalledWith(2, [draftB], 30_000)
    // The fast finding is reported straight away, before the retry lands.
    expect(updates[0]?.get('drafts.a')).toBe(failed)
    expect(updates.at(-1)?.get('drafts.b')).toBe(failed)
    expect(left).toBe(0)
  })

  it('says how many are still unevaluated once the retries run out', async () => {
    const validate = vi.fn().mockResolvedValue({results: new Map([['drafts.a', timedOut]])})
    const left = await validateUntilSettled([draftA], validate, () => {}, () => false, [1, 2])
    expect(validate).toHaveBeenCalledTimes(3)
    expect(left).toBe(1)
  })

  it('stops as soon as a newer batch supersedes it', async () => {
    const validate = vi.fn().mockResolvedValue({results: new Map([['drafts.a', timedOut]])})
    const onUpdate = vi.fn()
    await validateUntilSettled([draftA], validate, onUpdate, () => true, [1])
    expect(onUpdate).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledTimes(1)
  })
})

describe('describeValidationPath', () => {
  // The shape of the path reported from a real Studio:
  // pageBuilder.[key].buttons.[key].url.internal
  const urlType = {
    name: 'customUrl',
    title: 'URL',
    jsonType: 'object',
    fields: [{name: 'internal', type: {name: 'reference', title: 'Internal link', jsonType: 'object'}}],
  }
  const buttonType = {
    name: 'button',
    title: 'Button',
    jsonType: 'object',
    fields: [{name: 'url', type: urlType}],
  }
  const heroType = {
    name: 'hero',
    title: 'Hero',
    jsonType: 'object',
    fields: [{name: 'buttons', type: {name: 'array', title: 'Buttons', jsonType: 'array', of: [buttonType]}}],
  }
  const pageType = {
    name: 'page',
    title: 'Page',
    jsonType: 'object',
    fields: [{name: 'pageBuilder', type: {name: 'array', title: 'Page builder', jsonType: 'array', of: [heroType]}}],
  }
  const schema = {get: (name: string) => (name === 'page' ? pageType : undefined)}
  const draft = {
    _type: 'page',
    pageBuilder: [{_key: 'h1', _type: 'hero', buttons: [{_key: 'b1', _type: 'button', url: {}}]}],
  }

  it('reads as the form does: field titles and block types, no keys', () => {
    expect(
      describeValidationPath(schema, 'page', draft, ['pageBuilder', {_key: 'h1'}, 'buttons', {_key: 'b1'}, 'url', 'internal']),
    ).toBe('Page builder › Hero › Buttons › Button › URL › Internal link')
  })

  it('falls back to field names for anything the schema cannot resolve, never to keys', () => {
    expect(describeValidationPath(schema, 'unknownType', {}, ['a', {_key: 'x'}, 'b'])).toBe('a › b')
  })
})
