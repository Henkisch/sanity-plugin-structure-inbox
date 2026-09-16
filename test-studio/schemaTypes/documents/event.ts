import {CalendarIcon} from '@sanity/icons/Calendar'
import {defineField, defineType} from 'sanity'

export const event = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  icon: CalendarIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'startsAt', type: 'datetime'}),
    defineField({name: 'venue', type: 'string'}),
    // Exercises the wrapper-object alt-text convention (see `objects/imageWithAlt.ts`) —
    // `post.ts`'s own `heroImage` already covers the customized-`image` convention.
    defineField({name: 'coverImage', type: 'imageWithAlt'}),
  ],
})
