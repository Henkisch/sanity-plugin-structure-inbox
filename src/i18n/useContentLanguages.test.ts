import {describe, expect, it} from 'vitest'

import {documentLanguage, documentLanguageField} from './useContentLanguages'

const documentType = {name: 'document', jsonType: 'object'}

function schemaWith(types: {name: string; fields: string[]}[]) {
  const byName = new Map(
    types.map((type) => [
      type.name,
      {
        name: type.name,
        jsonType: 'object',
        type: documentType,
        fields: type.fields.map((name) => ({name, type: {name: 'string', jsonType: 'string'}})),
      },
    ]),
  )
  return {getTypeNames: () => [...byName.keys()], get: (name: string) => byName.get(name)}
}

describe('documentLanguageField', () => {
  const schema = schemaWith([
    {name: 'page', fields: ['title', 'language']},
    {name: 'faq', fields: ['question', 'language']},
    {name: 'product', fields: ['title']},
  ])

  it('finds exactly the document types that declare the language field', () => {
    expect(documentLanguageField(schema, 'language')).toEqual({
      field: 'language',
      types: new Set(['page', 'faq']),
    })
  })

  it('is undefined in a Studio without document-level translation', () => {
    expect(documentLanguageField(schemaWith([{name: 'post', fields: ['title']}]), 'language')).toBeUndefined()
  })

  it("survives the schema's abstract `document` type, which has no fields at all", () => {
    const withBase = {
      getTypeNames: () => ['document', ...schema.getTypeNames()],
      get: (name: string) => (name === 'document' ? {name: 'document', jsonType: 'object'} : schema.get(name)),
    }
    expect(documentLanguageField(withBase, 'language')?.types).toEqual(new Set(['page', 'faq']))
  })

  it('is undefined when turned off, or for a field name unsafe to put in a query', () => {
    expect(documentLanguageField(schema, undefined)).toBeUndefined()
    expect(documentLanguageField(schema, 'language->x')).toBeUndefined()
  })
})

describe('documentLanguage', () => {
  const field = {field: 'language', types: new Set(['page'])}

  it('reads the language only on a type that has one', () => {
    expect(documentLanguage(field, 'page', 'sv')).toBe('sv')
    expect(documentLanguage(field, 'product', 'sv')).toBeUndefined()
  })

  it('ignores an empty or non-string value, and a Studio without the field', () => {
    expect(documentLanguage(field, 'page', '')).toBeUndefined()
    expect(documentLanguage(field, 'page', null)).toBeUndefined()
    expect(documentLanguage(undefined, 'page', 'sv')).toBeUndefined()
  })
})
