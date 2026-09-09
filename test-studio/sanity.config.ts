import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {structureHome} from 'sanity-plugin-structure-home'
import {structureTool} from 'sanity/structure'
import {type StructureResolver} from 'sanity/structure'

import {activeToolLayoutProbe} from './plugins/activeToolLayoutProbe'
import {schemaTypes} from './schemaTypes'

const projectId = process.env.SANITY_STUDIO_PROJECT_ID!
const dataset = process.env.SANITY_STUDIO_DATASET || 'production'

/**
 * A hand-built root list, not `S.defaults()`. The plugin has to inject its item
 * above a singleton and a divider that the developer already put there, which
 * is the shape a real project's structure has.
 */
const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Site settings')
        .id('siteSettings')
        .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
      S.divider(),
      ...S.documentTypeListItems().filter((item) => item.getId() !== 'siteSettings'),
    ])

export default defineConfig([
  {
    name: 'default',
    title: 'Structure Home',
    basePath: '/default',
    projectId,
    dataset,
    plugins: [
      structureTool({structure}),
      structureHome(),
      // Stacked on purpose — see the probe's own comment.
      activeToolLayoutProbe(),
      visionTool(),
    ],
    schema: {types: schemaTypes},
  },
  {
    // Covers the degradation path: a root that is not a list, so the Home item
    // cannot be injected. Expect a console warning, a working Studio, and no
    // redirect.
    name: 'noList',
    title: 'No list at root',
    basePath: '/no-list',
    projectId,
    dataset,
    plugins: [structureTool({structure: (S) => S.documentTypeList('post')}), structureHome()],
    schema: {types: schemaTypes},
  },
  {
    // Two structure tools, with the Home pane attached to the second one only.
    // Opening "Content" must behave exactly as it did before the plugin.
    name: 'multi',
    title: 'Two structure tools',
    basePath: '/multi',
    projectId,
    dataset,
    plugins: [
      structureTool({structure}),
      structureTool({
        name: 'cars',
        title: 'Cars',
        structure: (S) => S.list().title('Cars').items(S.documentTypeListItems()),
      }),
      structureHome({toolName: 'cars'}),
    ],
    schema: {types: schemaTypes},
  },
])
