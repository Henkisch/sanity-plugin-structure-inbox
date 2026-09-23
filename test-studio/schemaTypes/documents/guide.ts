import {BookIcon} from '@sanity/icons/Book'
import {defineField, defineType} from 'sanity'

/**
 * Document-level localization: one document per language, linked by
 * `@sanity/document-internationalization`'s `translation.metadata`. Sibling
 * translations share a title, which is what the inbox's language badge and
 * language filter exist to tell apart (plan 090).
 */
export const guide = defineType({
  name: 'guide',
  title: 'Guide',
  type: 'document',
  icon: BookIcon,
  fields: [
    defineField({name: 'title', type: 'string'}),
    // Managed by the document-internationalization plugin itself.
    defineField({name: 'language', type: 'string', readOnly: true, hidden: true}),
  ],
})
