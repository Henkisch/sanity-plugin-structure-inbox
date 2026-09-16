import {defineField, defineType} from 'sanity'

// The other common alt-text convention alongside `post.ts`'s customized
// `image` field: a reusable wrapper object, used as the field's type
// instead of customizing `image` directly.
export const imageWithAlt = defineType({
  name: 'imageWithAlt',
  title: 'Image with alt text',
  type: 'object',
  fields: [
    defineField({name: 'image', type: 'image', options: {hotspot: true}}),
    defineField({name: 'alt', type: 'string', title: 'Alt text'}),
  ],
})
