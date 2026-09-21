import {UserIcon} from '@sanity/icons/User'
import {defineField, defineType} from 'sanity'

export const author = defineType({
  name: 'author',
  title: 'Author',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({name: 'name', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'bio', type: 'text', rows: 3}),
    // The portrait case `altFromTitle` exists for: the image is a picture of
    // this document's own subject, so the author's own name IS the correct
    // alt text. Wired up in `sanity.config.ts`.
    defineField({
      name: 'portrait',
      type: 'image',
      options: {hotspot: true},
      fields: [defineField({name: 'alt', type: 'string', title: 'Alt text'})],
    }),
  ],
})
