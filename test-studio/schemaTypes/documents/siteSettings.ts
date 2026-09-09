import {CogIcon} from '@sanity/icons/Cog'
import {defineField, defineType} from 'sanity'

/**
 * A singleton. Its presence keeps the root list non-trivial: the injected Home
 * item has to sit above a hand-built list item, not only above the generated
 * document type items.
 */
export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  fields: [
    defineField({name: 'title', type: 'string'}),
    defineField({name: 'description', type: 'text', rows: 2}),
  ],
})
