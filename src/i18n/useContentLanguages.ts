import {isDocumentSchemaType} from '@sanity/types'
import {createContext, useContext, useMemo} from 'react'
import {useCurrentLocale, useSchema} from 'sanity'

import {useSafely} from '../inbox/sources/capability'
import {SIMPLE_FIELD_PATH} from '../inbox/sources/simpleFieldPath'
import {type StructureInboxConfig} from '../types'

/** What `useCurrentLocale` falls back to with no `LocaleContext` — Sanity's own default locale. */
const FALLBACK_LOCALE = {id: 'en-US'}

/**
 * The plugin's own `i18n` option, made available to every source's `useItems`.
 *
 * Sources are built by factory functions that never see the plugin config, so
 * the option travels by context instead — provided once by
 * `createInboxCountLayout`, which wraps the whole Studio and therefore every
 * place a source runs (the pane, and the always-mounted count feed). No
 * provider (a unit test, a source rendered on its own) means the defaults.
 *
 * @internal
 */
export const ContentI18nContext = createContext<StructureInboxConfig['i18n']>(undefined)

/**
 * The content-language preference order every title is read in: the plugin's
 * `i18n.languages` when set, otherwise the editor's Studio locale followed by
 * its bare language (`sv-SE`, then `sv`), so a Studio running in `en-US` still
 * finds `en` entries.
 *
 * Memoized on the values, not the option object, so the array's identity only
 * changes when the preference itself does — it goes straight into sources'
 * `useMemo` dependency lists, where a fresh array per render would refetch.
 *
 * @internal
 */
export function useContentLanguages(): readonly string[] {
  const configured = useContext(ContentI18nContext)?.languages
  // `useSafely`: `useCurrentLocale` throws with no `LocaleContext`, from a
  // plain check after its one `useContext` — the shape `useSafely` documents
  // as safe. Every Studio has one; a source rendered on its own in a test
  // doesn't, and a title preference is no reason to fail there.
  const localeId = useSafely<{id: string}>(useCurrentLocale, FALLBACK_LOCALE).id
  const configuredKey = configured?.join('\u0000')

  return useMemo(() => {
    if (configuredKey !== undefined && configuredKey !== '') return configuredKey.split('\u0000')
    const prefix = localeId.split(/[-_]/)[0] ?? localeId
    return prefix && prefix !== localeId ? [localeId, prefix] : [localeId]
  }, [configuredKey, localeId])
}

/**
 * The one content language this plugin may *write* in — the first of the
 * plugin's own `i18n.languages`, or `undefined` when that isn't configured.
 *
 * Deliberately not the Studio-locale default `useContentLanguages` falls back
 * to: a Studio locale id (`en-US`) is a UI language, not proof that content
 * uses that id, and writing a localized entry under a language the dataset
 * doesn't have creates a translation nobody asked for. Reading can afford a
 * guess; writing can't.
 *
 * @internal
 */
export function useContentWriteLanguage(): string | undefined {
  return useContext(ContentI18nContext)?.languages?.[0]
}

/** Where a document-level translation keeps its language, and which types have one. */
export interface DocumentLanguageField {
  /** The field name, already checked against `SIMPLE_FIELD_PATH`. */
  field: string
  /** Document types whose schema declares `field` — the only ones it is read on. */
  types: ReadonlySet<string>
}

const DEFAULT_LANGUAGE_FIELD = 'language'

/**
 * The document types that carry a language of their own, found from the
 * schema rather than configured: a type is document-level translated exactly
 * when it declares the language field (`@sanity/document-internationalization`
 * adds it to every type it manages). `undefined` when the option is `false`,
 * the name isn't a plain field name, or no type has it — so every caller's
 * "no document-level translation here" path is one check.
 *
 * Memoized on the schema and the field name only; both are stable for a
 * Studio session, so the result can sit in a source's dependency list.
 *
 * @internal
 */
export function useDocumentLanguageField(): DocumentLanguageField | undefined {
  const option = useContext(ContentI18nContext)?.languageField
  const field = option === false ? undefined : (option ?? DEFAULT_LANGUAGE_FIELD)
  const schema = useSchema()

  return useMemo(() => documentLanguageField(schema, field), [schema, field])
}

/** The pure half of {@link useDocumentLanguageField}, exported for its own test. @internal */
export function documentLanguageField(
  schema: {getTypeNames: () => string[]; get: (name: string) => unknown},
  field: string | undefined,
): DocumentLanguageField | undefined {
  if (!field || !SIMPLE_FIELD_PATH.test(field)) return undefined
  const types = new Set<string>()
  for (const name of schema.getTypeNames()) {
    const type = schema.get(name)
    if (!type || !isDocumentSchemaType(type)) continue
    // `?? []` despite the type saying `fields` is always there: the schema's
    // own abstract `document` base type passes `isDocumentSchemaType` with no
    // fields at all. Found live, in a Studio with no i18n of any kind — the
    // same trap `findAltEligibleImageFields` documents.
    if ((type.fields ?? []).some((candidate) => candidate.name === field)) types.add(name)
  }
  return types.size > 0 ? {field, types} : undefined
}

/**
 * A document's language, read off a fetched value — only for a type that
 * declares the language field, and only when it holds a non-empty string.
 *
 * @internal
 */
export function documentLanguage(
  languageField: DocumentLanguageField | undefined,
  type: string,
  value: unknown,
): string | undefined {
  if (!languageField?.types.has(type)) return undefined
  return typeof value === 'string' && value ? value : undefined
}
