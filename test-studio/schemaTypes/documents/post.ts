import {DocumentTextIcon} from '@sanity/icons/DocumentText'
import {defineField, defineType} from 'sanity'

export const post = defineType({
  name: 'post',
  title: 'Post',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (rule) => rule.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'title'}}),
    defineField({name: 'publishedAt', type: 'datetime'}),
    defineField({name: 'author', type: 'reference', to: [{type: 'author'}]}),
    defineField({name: 'body', type: 'text', rows: 6}),
    // Plan 026 spike fixture: gives `altTextProposals` something real to
    // find. Not otherwise used by the plugin itself.
    defineField({
      name: 'heroImage',
      type: 'image',
      options: {hotspot: true},
      fields: [defineField({name: 'alt', type: 'string', title: 'Alt text'})],
    }),
    // Plan 060 fixture: the only `file` field in this workspace, so the only
    // way to exercise `sanity.fileAsset` at all. `assetIssues` queries image
    // and file assets alike, and nothing here had a file field — which is
    // how the file half of the feature went unverified until someone asked.
    defineField({
      name: 'pressKit',
      type: 'file',
      title: 'Press kit (PDF)',
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'author.name'},
  },
})
