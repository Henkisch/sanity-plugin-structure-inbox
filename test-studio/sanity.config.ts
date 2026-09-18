import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {
  assetIssues,
  documentValidation,
  needsAttention,
  openTasks,
  structureInbox,
  todos,
  unpublishedDrafts,
  unresolvedComments,
  upcomingReleases,
} from 'sanity-plugin-structure-inbox'
import {linkCheckerFindings} from 'sanity-plugin-structure-inbox/link-checker'
import {structureTool} from 'sanity/structure'
import {type StructureResolver} from 'sanity/structure'

import {schemaTypes} from './schemaTypes'
import {unmemoizedCanary} from './unmemoizedCanary'

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

export default defineConfig({
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
      // showInList: true,
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
        // Deliberately unmemoized — see its own doc comment. Nothing else
        // configured here returns a fresh `items` array per render, which is
        // exactly why the loop that crashed a customer's Studio never showed
        // up in this workspace.
        unmemoizedCanary(),
      ],
    }),
    visionTool(),
  ],
  schema: {types: schemaTypes},
})
