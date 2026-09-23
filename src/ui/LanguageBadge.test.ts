import {describe, expect, it} from 'vitest'

import {languageDisplayName} from './LanguageBadge'

describe('languageDisplayName', () => {
  it('names a language in the UI locale, capitalized for a label', () => {
    expect(languageDisplayName('sv', 'en-US')).toBe('Swedish')
    // Swedish writes its language names lowercase in running text.
    expect(languageDisplayName('en', 'sv-SE')).toBe('Engelska')
  })

  it('falls back to the raw id for something that is not a language code', () => {
    expect(languageDisplayName('not a code!', 'en-US')).toBe('not a code!')
  })
})
