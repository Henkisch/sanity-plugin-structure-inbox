/**
 * Turning a document's own field value into row text, whatever shape content
 * i18n gave it.
 *
 * Every built-in source reads a document's title as `coalesce(title, name,
 * label)` and used to hand the result straight to a row. That is only a string
 * in a Studio that doesn't localize its fields: `sanity-plugin-internationalized-array`
 * makes it `[{_key, _type, language, value}]`, the older `localeString` pattern
 * makes it `{en: '…', sv: '…'}`, and a Portable Text title is an array of
 * blocks. Rendered as a React child, any of those throws — and a row throwing
 * took down the whole Structure tool before rows had their own boundary. This
 * file is the one place a raw field value becomes text.
 */

/** Options shared by {@link pickLocalized} and {@link toDisplayTitle}. */
export interface LocalizedReadOptions {
  /**
   * Only ever return one of `languages` — never the "any language it has"
   * fallback. For a caller about to *write* text in a specific language (an
   * alt-text fix), where a title in some other language is the wrong answer
   * rather than a better-than-nothing one.
   */
  strict?: boolean
}

/** One entry of a localized value, as far as picking a language goes. */
export interface LocalizedEntry {
  /** The language this entry is in — `language`, or `_key` on older internationalized-array data. */
  language: string
  /** The entry's own value, still raw (it may itself be Portable Text). */
  value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The language an internationalized-array entry is in, or `undefined` when the
 * value isn't one. `language` is the current field; releases of
 * `sanity-plugin-internationalized-array` before it moved there keyed each
 * entry by language in `_key` instead, and both still exist in real datasets.
 */
function entryLanguage(entry: unknown): string | undefined {
  if (!isRecord(entry) || !('value' in entry)) return undefined
  if (typeof entry.language === 'string' && entry.language) return entry.language
  if (typeof entry._key === 'string' && entry._key) return entry._key
  return undefined
}

function isLocalizedArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => entryLanguage(entry) !== undefined)
  )
}

function isPortableText(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.some((block) => isRecord(block) && block._type === 'block')
  )
}

function portableTextToPlain(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      if (!isRecord(block) || block._type !== 'block' || !Array.isArray(block.children)) return ''
      return block.children
        .map((child) => (isRecord(child) && typeof child.text === 'string' ? child.text : ''))
        .join('')
    })
    .filter(Boolean)
    .join(' ')
}

/** `sv-SE` → `sv`; `sv` → `sv`. */
function languagePrefix(language: string): string {
  return (language.split(/[-_]/)[0] ?? language).toLowerCase()
}

/**
 * Which entry of a localized value to show, by preference: each of `languages`
 * in order (an exact match first, then the same language ignoring region, so
 * `sv-SE` finds `sv`), and otherwise the first entry that has text at all.
 *
 * Handles both localized shapes: an internationalized array, and a
 * `localeString`-style object keyed by language. The object form never falls
 * back to "whatever key comes first" — an object that merely *happens* to have
 * string values is not evidence of a language map, so without a preferred
 * language present it returns `null` rather than guess.
 *
 * `null` when the value isn't localized, or when no entry has any text.
 */
export function pickLocalized(
  value: unknown,
  languages: readonly string[],
  options: LocalizedReadOptions = {},
): LocalizedEntry | null {
  let entries: LocalizedEntry[]
  let allowAnyFallback: boolean

  if (isLocalizedArray(value)) {
    entries = value.flatMap((entry) => {
      const language = entryLanguage(entry)
      return language && isRecord(entry) ? [{language, value: entry.value}] : []
    })
    allowAnyFallback = true
  } else if (isRecord(value) && !('_ref' in value)) {
    entries = Object.entries(value)
      .filter(([key]) => !key.startsWith('_'))
      .map(([language, entryValue]) => ({language, value: entryValue}))
    allowAnyFallback = false
  } else {
    return null
  }

  const withText = entries.filter((entry) => toDisplayTitle(entry.value, languages, options) !== null)

  for (const wanted of languages) {
    const exact = withText.find((entry) => entry.language === wanted)
    if (exact) return exact
    const prefix = languagePrefix(wanted)
    const loose = withText.find((entry) => languagePrefix(entry.language) === prefix)
    if (loose) return loose
  }

  return allowAnyFallback && !options.strict ? (withText[0] ?? null) : null
}

/**
 * A field value as a single line of row text, or `null` when it has none.
 *
 * - a string: trimmed (`null` when blank)
 * - a localized value: the preferred language's text, per {@link pickLocalized}
 * - Portable Text: its blocks' plain text, joined with a space
 * - anything else (a number, a reference, an unknown object): `null`, so the
 *   caller's own "no title" fallback takes over
 *
 * `languages` is the content-language preference order — see
 * `useContentLanguages` for where it comes from.
 */
export function toDisplayTitle(
  value: unknown,
  languages: readonly string[],
  options: LocalizedReadOptions = {},
): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (isPortableText(value)) return portableTextToPlain(value).trim() || null
  const entry = pickLocalized(value, languages, options)
  return entry ? toDisplayTitle(entry.value, languages, options) : null
}
