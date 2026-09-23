import {DropIcon} from '@sanity/icons/Drop'
import {defineField, defineType} from 'sanity'

/**
 * Field-level localization, the shape that crashed a customer's Structure
 * tool: `sanity-plugin-internationalized-array` stores `title` as
 * `[{_key, _type, language, value}]`, which every built-in source used to hand
 * straight to a row. The photo's alt text is localized the same way, so the
 * alt-text check and its fix are exercised against an array field too.
 */
export const cocktail = defineType({
  name: 'cocktail',
  title: 'Cocktail',
  type: 'document',
  icon: DropIcon,
  fields: [
    defineField({name: 'title', type: 'internationalizedArrayString'}),
    defineField({
      name: 'photo',
      type: 'image',
      fields: [defineField({name: 'alt', type: 'internationalizedArrayString', title: 'Alt text'})],
    }),
  ],
  preview: {
    select: {title: 'title.0.value', media: 'photo'},
  },
})
