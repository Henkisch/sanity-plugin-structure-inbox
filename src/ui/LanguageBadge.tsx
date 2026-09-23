import {Badge} from '@sanity/ui'

import {COUNT_MONOSPACE_FONT_FAMILY} from './CountBadge'

/**
 * `sv` → `Swedish` (in the browser's language, or `uiLocale` when given), for a tooltip. The raw
 * id when the runtime has no `Intl.DisplayNames` or doesn't know the code —
 * a dataset's language ids are whatever the project chose, not always BCP 47.
 *
 * @internal
 */
export function languageDisplayName(language: string, uiLocale?: string): string {
  try {
    return new Intl.DisplayNames(uiLocale ? [uiLocale] : undefined, {type: 'language'}).of(language) ?? language
  } catch {
    return language
  }
}

/**
 * Which language a row is in, for document-level translation — where each
 * language is its own document and two rows otherwise read identically. A
 * short uppercase code in the same monospace `CountBadge` uses, so it reads
 * as a label rather than as words in the title.
 *
 * @internal
 */
export function LanguageBadge(props: {language: string; uiLocale?: string}) {
  const name = languageDisplayName(props.language, props.uiLocale)
  return (
    <Badge
      aria-label={name}
      fontSize={0}
      padding={1}
      radius={2}
      style={{flexShrink: 0}}
      title={name}
    >
      <span style={{fontFamily: COUNT_MONOSPACE_FONT_FAMILY, fontWeight: 600, textTransform: 'uppercase'}}>
        {props.language}
      </span>
    </Badge>
  )
}
