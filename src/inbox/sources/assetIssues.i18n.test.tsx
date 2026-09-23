import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {type ReactNode} from 'react'
import {Subject} from 'rxjs'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {ContentI18nContext} from '../../i18n/useContentLanguages'
import {type StructureInboxI18nConfig} from '../../types'
import {altFieldShape, assetIssues} from './assetIssues'

/**
 * Localized content through `assetIssues`: a title stored by
 * `sanity-plugin-internationalized-array`, and an alt field of that same
 * kind. The two ways this used to go wrong were a crash (a localized title
 * reaching `.trim()` and a React child) and a corruption (a plain string
 * patched over a localized alt array) — both are asserted against here.
 */

const documentType = {name: 'document', jsonType: 'object' as const}
const stringType = {name: 'string', jsonType: 'string' as const}
const localizedStringType = {name: 'internationalizedArrayString', jsonType: 'array' as const}

function personWithAlt(altType: {name: string; jsonType: string}) {
  return {
    name: 'person',
    title: 'Person',
    jsonType: 'object' as const,
    type: documentType,
    fields: [
      {
        name: 'portrait',
        type: {name: 'image', jsonType: 'object' as const, fields: [{name: 'alt', type: altType}]},
      },
    ],
  }
}

const {useClientMock, schemaRef} = vi.hoisted(() => {
  // Swapped per test, but one stable object for the duration of each — a
  // fresh schema per render would recompute the whole fetch pipeline.
  const ref: {current: unknown} = {current: undefined}
  return {useClientMock: vi.fn(), schemaRef: ref}
})

vi.mock('./capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capability')>()),
  useAssignableUsers: () => ({data: undefined}),
}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useSchema: () => schemaRef.current,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
  }
})

function useSchemaWith(type: ReturnType<typeof personWithAlt>) {
  schemaRef.current = {
    getTypeNames: () => ['person'],
    get: (name: string) => (name === 'person' ? type : undefined),
  }
}

const LOCALIZED_TITLE = [
  {_key: 'en', _type: 'internationalizedArrayStringValue', language: 'en', value: 'Daniel Vaziri'},
  {_key: 'sv', _type: 'internationalizedArrayStringValue', language: 'sv', value: 'Daniel Vaziri (sv)'},
]

function stubClient(rows: {missingAlt?: unknown[]; poorAlt?: unknown[]; currentAlt?: unknown}) {
  const commit = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn(() => ({commit}))
  const patch = vi.fn(() => ({set}))

  const fetch = vi.fn(async (query: string) => {
    if (query.startsWith('*[_id == $id][0].')) return rows.currentAlt ?? null
    if (query.includes('"safeTitle"')) return rows.missingAlt ?? []
    if (query.includes('"alt":')) return rows.poorAlt ?? []
    if (query.startsWith('count(')) return 0
    return []
  })

  const client = {
    config: () => ({dataset: 'production'}),
    fetch,
    observable: {fetch: vi.fn()},
    listen: vi.fn(() => new Subject()),
    patch,
  } as unknown as SanityClient

  return {client, fetch, patch, set, commit}
}

async function render(
  options: Parameters<typeof assetIssues>[0],
  rows: Parameters<typeof stubClient>[0],
  i18n?: StructureInboxI18nConfig,
) {
  const stubbed = stubClient(rows)
  useClientMock.mockReturnValue(stubbed.client)
  const source = assetIssues(options)
  const wrapper = ({children}: {children: ReactNode}) => (
    <ContentI18nContext.Provider value={i18n}>{children}</ContentI18nContext.Provider>
  )
  const {result} = renderHook(() => source.useItems(), {wrapper})
  await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
  return {...stubbed, result}
}

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
})

describe('altFieldShape', () => {
  it('tells a plain string, an internationalized array and any other localized shape apart', () => {
    expect(altFieldShape(stringType)).toBe('string')
    expect(altFieldShape({name: 'string'})).toBe('string')
    expect(altFieldShape(localizedStringType)).toBe('internationalizedArray')
    expect(altFieldShape({name: 'localeString', jsonType: 'object'})).toBe('localized')
  })
})

describe('assetIssues — a localized title on a plain alt field', () => {
  it('titles the row, and fills alt text from the title in the preferred language', async () => {
    useSchemaWith(personWithAlt(stringType))
    const {result, set} = await render(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{_id: 'person-1', title: LOCALIZED_TITLE, safeTitle: LOCALIZED_TITLE}]},
      {languages: ['sv']},
    )

    const item = result.current.items[0]
    expect(item.title).toBe('Daniel Vaziri (sv)')

    const proposal = await result.current.proposeFix!(item)
    await proposal!.apply()
    expect(set).toHaveBeenCalledWith({'portrait.alt': 'Daniel Vaziri (sv)'})
  })
})

describe('assetIssues — an internationalized-array alt field', () => {
  it('asks for images with no alt text in any language', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const {fetch} = await render(
      {},
      {missingAlt: [{_id: 'person-1', title: LOCALIZED_TITLE, safeTitle: LOCALIZED_TITLE}]},
    )

    const missingQuery = fetch.mock.calls.map(([query]) => query).find((q) => q.includes('"safeTitle"'))
    expect(missingQuery).toContain(
      '(!defined(portrait.alt) || count(portrait.alt[defined(value) && value != ""]) == 0)',
    )
  })

  it('writes one localized entry in the configured language — never a plain string', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const {result, set} = await render(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{_id: 'person-1', title: LOCALIZED_TITLE, safeTitle: LOCALIZED_TITLE}]},
      {languages: ['sv']},
    )

    const item = result.current.items[0]
    expect(item.quickFixable).toBe(true)
    const proposal = await result.current.proposeFix!(item)
    await proposal!.apply()

    expect(set).toHaveBeenCalledWith({
      'portrait.alt': [
        {
          _key: 'sv',
          _type: 'internationalizedArrayStringValue',
          language: 'sv',
          value: 'Daniel Vaziri (sv)',
        },
      ],
    })
  })

  it('offers no fix when no content language is configured to write in', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const {result} = await render(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{_id: 'person-1', title: LOCALIZED_TITLE, safeTitle: LOCALIZED_TITLE}]},
    )

    const item = result.current.items[0]
    // Still a row, still readable, still opens the document.
    expect(item.title).toBe('Daniel Vaziri')
    expect(item.quickFixable).toBe(false)
    expect(item.fixable).toBe(false)
    expect(await result.current.proposeFix!(item)).toBeNull()
  })

  it('does not copy a title from another language into the entry it writes', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const englishOnly = [LOCALIZED_TITLE[0]]
    const {result} = await render(
      {altFromTitle: ['person.portrait']},
      {missingAlt: [{_id: 'person-1', title: englishOnly, safeTitle: englishOnly}]},
      {languages: ['sv']},
    )

    expect(result.current.items[0]?.quickFixable).toBe(false)
  })

  it('proposes nothing once any entry has text — the re-read guard', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const {result} = await render(
      {altFromTitle: ['person.portrait']},
      {
        missingAlt: [{_id: 'person-1', title: LOCALIZED_TITLE, safeTitle: LOCALIZED_TITLE}],
        currentAlt: [{_key: 'en', language: 'en', value: 'A portrait'}],
      },
      {languages: ['sv']},
    )

    expect(await result.current.proposeFix!(result.current.items[0])).toBeNull()
  })

  it('classifies localized alt text that is only a placeholder', async () => {
    useSchemaWith(personWithAlt(localizedStringType))
    const {result} = await render(
      {},
      {
        poorAlt: [
          {
            _id: 'person-1',
            title: LOCALIZED_TITLE,
            alt: [{_key: 'en', language: 'en', value: 'image'}],
          },
        ],
      },
      {languages: ['en']},
    )

    expect(result.current.items[0]?.category).toBe('Generic alt text')
    expect(result.current.items[0]?.title).toBe('Daniel Vaziri')
  })
})
