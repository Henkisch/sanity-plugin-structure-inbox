import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {
  openTasks,
  structureInbox,
  todos,
  unpublishedDrafts,
  upcomingReleases,
} from 'sanity-plugin-structure-inbox'
import {structureTool} from 'sanity/structure'
import {type StructureResolver} from 'sanity/structure'

import {activeToolLayoutProbe} from './plugins/activeToolLayoutProbe'
import {navBadgeSpike} from './plugins/navBadgeSpike'
import {navbarBadgeSpike} from './plugins/navbarBadgeSpike'
import {teamViewSpike} from './plugins/teamViewSpike'
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
        // showInList: true,
        sources: [
          // The personal list: assigned tasks, with a real "Mark as done".
          openTasks(),
          // Zero days, so a draft made seconds ago shows up — a seven-day
          // default would make this workspace look broken while testing.
          unpublishedDrafts({olderThanDays: 0}),
          upcomingReleases(),
          todos(),
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
  {
    // An async structure resolver, deliberately slow. Proves the list item and
    // the landing redirect both still happen once the promise settles, well
    // after this component's own effects have already flushed once — and that
    // a deep link opened during the delay is not hijacked when it resolves.
    name: 'asyncDelayed',
    title: 'Delayed async structure',
    basePath: '/async-delayed',
    projectId,
    dataset,
    plugins: [
      structureTool({
        structure: async (S) => {
          await new Promise((resolve) => setTimeout(resolve, 750))
          return S.list().title('Content').items(S.documentTypeListItems())
        },
      }),
      structureInbox({showInList: true, sources: [unpublishedDrafts({olderThanDays: 0})]}),
    ],
    schema: {types: schemaTypes},
  },
  {
    // Plan 011 spike: a live badge on the Structure tool's own nav icon, via
    // `Tool.icon` as a React component rather than a `studio.components.navbar`
    // override — see `plans/011-investigate-nav-badge.md` and
    // `./plugins/navBadgeSpike.tsx`.
    name: 'badgeSpike',
    title: 'Nav badge spike',
    basePath: '/badge-spike',
    projectId,
    dataset,
    plugins: [
      structureTool({structure}),
      structureInbox({sources: [unpublishedDrafts({olderThanDays: 0})]}),
      navBadgeSpike(),
      navbarBadgeSpike(),
    ],
    schema: {types: schemaTypes},
  },
  {
    // Plan 012 spike: a throwaway "who's sitting on what" team view, grouping
    // the same 'everyone'-audience items the personal Inbox pane already
    // fetches, by assignee instead of by tone/timestamp. See
    // `plans/012-team-wide-view.md`. Not a shipped surface — kept in its own
    // workspace so it never appears next to the real Inbox pane.
    name: 'teamViewSpike',
    title: 'Team view spike',
    basePath: '/team-view-spike',
    projectId,
    dataset,
    plugins: [structureTool({structure}), teamViewSpike(), visionTool()],
    schema: {types: schemaTypes},
  },
])
