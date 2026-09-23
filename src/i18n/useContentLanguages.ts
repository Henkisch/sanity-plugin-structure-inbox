import {createContext, useContext, useMemo} from 'react'
import {useCurrentLocale} from 'sanity'

import {useSafely} from '../inbox/sources/capability'
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
