import {describe, expect, it} from 'vitest'

import {pickLocalized, toDisplayTitle} from './contentText'

const entry = (language: string, value: unknown, _type = 'internationalizedArrayStringValue') => ({
  _key: `k-${language}`,
  _type,
  language,
  value,
})

describe('toDisplayTitle', () => {
  it('trims a plain string, and treats a blank one as no title', () => {
    expect(toDisplayTitle('  Hello  ', ['en'])).toBe('Hello')
    expect(toDisplayTitle('   ', ['en'])).toBeNull()
    expect(toDisplayTitle('', ['en'])).toBeNull()
  })

  it('reads the payload from the reported crash', () => {
    const title = [
      {
        _key: 'sv',
        _type: 'internationalizedArrayStringValue',
        language: 'sv',
        value: 'Skrea Summer Olive Sour',
      },
    ]
    expect(toDisplayTitle(title, ['en-US', 'en'])).toBe('Skrea Summer Olive Sour')
  })

  it('prefers an exact language match', () => {
    const title = [entry('en', 'Hello'), entry('sv', 'Hej')]
    expect(toDisplayTitle(title, ['sv'])).toBe('Hej')
  })

  it('matches a regional locale to its bare language', () => {
    const title = [entry('en', 'Hello'), entry('sv', 'Hej')]
    expect(toDisplayTitle(title, ['sv-SE'])).toBe('Hej')
  })

  it('follows the preference order, not the entry order', () => {
    const title = [entry('de', 'Hallo'), entry('en', 'Hello'), entry('sv', 'Hej')]
    expect(toDisplayTitle(title, ['sv', 'en'])).toBe('Hej')
    expect(toDisplayTitle(title, ['fr', 'en'])).toBe('Hello')
  })

  it('falls back to the first entry with text when no preferred language has any', () => {
    const title = [entry('de', ''), entry('sv', 'Hej')]
    expect(toDisplayTitle(title, ['en'])).toBe('Hej')
  })

  it('skips a preferred-language entry that is empty', () => {
    const title = [entry('en', '  '), entry('sv', 'Hej')]
    expect(toDisplayTitle(title, ['en'])).toBe('Hej')
  })

  it('is null when every entry is empty', () => {
    expect(toDisplayTitle([entry('en', ''), entry('sv', null)], ['en'])).toBeNull()
  })

  it('reads older internationalized-array data that keys entries by language in `_key`', () => {
    const title = [
      {_key: 'en', _type: 'internationalizedArrayStringValue', value: 'Hello'},
      {_key: 'sv', _type: 'internationalizedArrayStringValue', value: 'Hej'},
    ]
    expect(toDisplayTitle(title, ['sv'])).toBe('Hej')
  })

  it('never falls back to another language under `strict`', () => {
    const title = [entry('en', 'Hello')]
    expect(toDisplayTitle(title, ['sv'], {strict: true})).toBeNull()
    expect(toDisplayTitle(title, ['en'], {strict: true})).toBe('Hello')
  })

  it('reads Portable Text as plain text', () => {
    const blocks = [
      {_type: 'block', children: [{_type: 'span', text: 'Hello '}, {_type: 'span', text: 'there'}]},
      {_type: 'block', children: [{_type: 'span', text: 'friend'}]},
    ]
    expect(toDisplayTitle(blocks, ['en'])).toBe('Hello there friend')
  })

  it('reads a localized Portable Text value', () => {
    const title = [
      entry('sv', [{_type: 'block', children: [{_type: 'span', text: 'Hej'}]}], 'internationalizedArrayTextValue'),
    ]
    expect(toDisplayTitle(title, ['sv'])).toBe('Hej')
  })

  it('reads a `localeString`-style object in a preferred language', () => {
    const title = {_type: 'localeString', en: 'Hello', sv: 'Hej'}
    expect(toDisplayTitle(title, ['sv'])).toBe('Hej')
    expect(toDisplayTitle(title, ['sv-SE'])).toBe('Hej')
  })

  it('does not guess a language for an object with no preferred key', () => {
    expect(toDisplayTitle({_type: 'localeString', de: 'Hallo'}, ['en'])).toBeNull()
  })

  it('is null for anything that is not text', () => {
    expect(toDisplayTitle(42, ['en'])).toBeNull()
    expect(toDisplayTitle(null, ['en'])).toBeNull()
    expect(toDisplayTitle(undefined, ['en'])).toBeNull()
    expect(toDisplayTitle({_ref: 'abc', _type: 'reference'}, ['en'])).toBeNull()
    expect(toDisplayTitle({foo: 1}, ['en'])).toBeNull()
    expect(toDisplayTitle([1, 2], ['en'])).toBeNull()
    expect(toDisplayTitle([], ['en'])).toBeNull()
  })
})

describe('pickLocalized', () => {
  it('says which language it read', () => {
    expect(pickLocalized([entry('en', 'Hello'), entry('sv', 'Hej')], ['sv-SE'])).toEqual({
      language: 'sv',
      value: 'Hej',
    })
  })

  it('is null for a value that is not localized', () => {
    expect(pickLocalized('Hello', ['en'])).toBeNull()
  })
})
