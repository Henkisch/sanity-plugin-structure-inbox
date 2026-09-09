import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {structureInbox, unpublishedDrafts, upcomingReleases} from 'sanity-plugin-structure-inbox'
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
    title: 'Structure Inbox',
    basePath: '/default',
    projectId,
    dataset,
    plugins: [
      structureTool({structure}),
      // `showInList` is off by default; this workspace turns it on so both the
      // visible entry and the invisible resolution get exercised somewhere.
      structureInbox({
        showInList: true,
        sources: [
          // Zero days, so a draft made seconds ago shows up — a seven-day
          // default would make this workspace look broken while testing.
          unpublishedDrafts({olderThanDays: 0}),
          upcomingReleases(),
        ],
      }),
      // Stacked on purpose — see the probe's own comment.
      activeToolLayoutProbe(),
      visionTool(),
    ],
    schema: {types: schemaTypes},
  },
  {
    // A root that is not a list at all. Inbox is reached through the root's
    // child resolver rather than a list item, so it resolves here too.
    name: 'noList',
    title: 'No list at root',
    basePath: '/no-list',
    projectId,
    dataset,
    plugins: [
      structureTool({structure: (S) => S.documentTypeList('post')}),
      structureInbox({sources: [unpublishedDrafts({olderThanDays: 0})]}),
    ],
    schema: {types: schemaTypes},
  },
  {
    // Two structure tools, with the Inbox pane attached to the second one only.
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
      structureInbox({toolName: 'cars', sources: [upcomingReleases()]}),
    ],
    schema: {types: schemaTypes},
  },
])
