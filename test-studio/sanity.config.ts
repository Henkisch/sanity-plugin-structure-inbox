import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {
  assetIssues,
  documentValidation,
  needsAttention,
  openTasks,
  structureInbox,
  structureInboxTeamView,
  todos,
  unpublishedDrafts,
  unresolvedComments,
  upcomingReleases,
} from 'sanity-plugin-structure-inbox'
import {linkCheckerFindings} from 'sanity-plugin-structure-inbox/link-checker'
import {structureTool} from 'sanity/structure'
import {type StructureResolver} from 'sanity/structure'

import {activeToolLayoutProbe} from './plugins/activeToolLayoutProbe'
import {clusterSpike} from './plugins/clusterSpike'
import {navBadgeSpike} from './plugins/navBadgeSpike'
import {navbarBadgeSpike} from './plugins/navbarBadgeSpike'
import {proposalsSpike} from './plugins/proposalsSpike'
import {imageAltProposal, schemaTypes} from './schemaTypes'

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
      // `linkChecker()`, the standalone plugin's own Studio tool, is
      // deliberately NOT registered here: `linkCheckerFindings()` below
      // reads and runs scans directly from that plugin's headless `core`
      // (`readReport`/`runScan`/`writeReport`) and needs no Studio tool
      // mounted to do either — see that source's own doc comment. Only the
      // npm package is a dependency; its separate tool tab is not wanted.
      // `showInList` is off by default; this workspace turns it on so both the
      // visible entry and the invisible resolution get exercised somewhere.
      structureInbox({
        // Off by default (plan 022) — on here so this workspace exercises
        // it too, alongside every other surface it's built to demo.
        ask: true,
        // Off by default — on here for the same reason `ask` is.
        contentGaps: {},
        // Grounds every AI read (Summarize, Suggest todos, Ask, Find
        // content gaps) in what this project actually is, not just what's
        // in front of it.
        context:
          'A blog and events site for a small editorial team, published under posts, authors, and events.',
        showInList: true,
        sources: [
          // Everyone's open tasks, not just this editor's own — lets the new
          // assignee/type filter row in the merged list actually have
          // something to filter, and matches how a real team Studio is more
          // likely to configure it now that the pane has its own filter UI
          // instead of baking "just mine" into the query.
          openTasks({onlyMine: false}),
          // Zero days, so a draft made seconds ago shows up — a seven-day
          // default would make this workspace look broken while testing.
          unpublishedDrafts({olderThanDays: 0}),
          documentValidation(),
          assetIssues(),
          // Everyone's unresolved comment threads, not just this editor's
          // own mentions — same reasoning as `openTasks({onlyMine: false})`
          // above, and the only way this workspace's own single-editor
          // test comment (which mentions this same editor either way)
          // exercises both audience states meaningfully.
          unresolvedComments({onlyMine: false}),
          needsAttention(),
          upcomingReleases(),
          todos(),
          linkCheckerFindings(),
        ],
      }),
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
    // Confirms `useMiddlewareComponents` composes two plugins' own
    // `activeToolLayout` overrides through `renderDefault` — see the probe's
    // own comment. Verified working; kept in its own out-of-the-way
    // workspace rather than cluttering `default` with a permanent banner on
    // every visit now that it's served its purpose for day-to-day testing.
    name: 'activeToolLayoutProbe',
    title: 'activeToolLayout composition probe',
    basePath: '/active-tool-layout-probe',
    projectId,
    dataset,
    plugins: [
      structureTool({structure}),
      structureInbox({sources: [unpublishedDrafts({olderThanDays: 0})]}),
      activeToolLayoutProbe(),
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
    // Plan 018: the real, shipped "who's sitting on what" team view —
    // 'everyone'-audience items the personal Inbox pane already fetches,
    // grouped by assignee instead of by tone/timestamp. See
    // `plans/018-team-view-production.md`. Kept in its own workspace so it
    // never appears next to the real Inbox pane.
    name: 'teamViewSpike',
    title: 'Team view',
    basePath: '/team-view-spike',
    projectId,
    dataset,
    plugins: [structureTool({structure}), structureInboxTeamView(), visionTool()],
    schema: {types: schemaTypes},
  },
  {
    // Plan 025 spike: does clustering the merged inbox list into shared
    // problems produce groups an editor would recognise? See
    // `plans/mellow-weaving-cascade.md`'s "Findings — plan 025" and
    // `./plugins/clusterSpike.tsx`.
    name: 'clusterSpike',
    title: 'Cluster spike',
    basePath: '/cluster-spike',
    projectId,
    dataset,
    plugins: [structureTool({structure}), clusterSpike()],
    schema: {types: schemaTypes},
  },
  {
    // Plan 026 spike: agent-authored proposals as an inbox source. See
    // `plans/mellow-weaving-cascade.md`'s "Findings — plan 026",
    // `./functions/altTextProposals/index.ts`, and `./plugins/proposalsSpike.tsx`.
    name: 'proposalsSpike',
    title: 'Proposals spike',
    basePath: '/proposals-spike',
    projectId,
    dataset,
    plugins: [structureTool({structure}), structureInbox({sources: [proposalsSpike()]})],
    schema: {types: [...schemaTypes, imageAltProposal]},
  },
])
