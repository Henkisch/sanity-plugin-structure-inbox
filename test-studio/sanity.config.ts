import {visionTool} from '@sanity/vision'
import {internationalizedArray} from 'sanity-plugin-internationalized-array'
import {media} from 'sanity-plugin-media'
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
    // Field-level localization for the `cocktail` type — the plugin behind
    // the localized-title crash (plan 089).
    internationalizedArray({
      languages: [
        {id: 'sv', title: 'Swedish'},
        {id: 'en', title: 'English'},
      ],
      fieldTypes: ['string'],
    }),
    // The real `sanity-plugin-media`, behind an env toggle, because
    // `assetIssues` has to work in *both* states: it detects a media tool at
    // runtime (`useTools`) rather than depending on one, and the only honest
    // way to test a runtime detection is to actually install the thing and
    // then turn it off. Off by default — "no media plugin" is the state most
    // consuming Studios are in.
    //
    // Run with it: `SANITY_STUDIO_MEDIA_PLUGIN=1 npm run dev`
    ...(process.env.SANITY_STUDIO_MEDIA_PLUGIN ? [media()] : []),
    // `linkChecker()`, the standalone plugin's own Studio tool, is
    // deliberately NOT registered here: `linkCheckerFindings()` below
    // reads and runs scans directly from that plugin's headless `core`
    // (`readReport`/`runScan`/`writeReport`) and needs no Studio tool
    // mounted to do either — see that source's own doc comment. Only the
    // npm package is a dependency; its separate tool tab is not wanted.
    structureInbox({
      // Off by default (plan 022) — on here so this workspace exercises
      // it too, alongside every other surface it's built to demo.
      ask: true,
      // Content here is Swedish first, whatever the editor's UI language —
      // which is also what lets a localized alt-text fix write at all.
      i18n: {languages: ['sv', 'en']},
      // Off by default — on here for the same reason `ask` is.
      contentGaps: {},
      // Grounds every AI read (Summarize, Suggest todos, Ask, Find
      // content gaps) in what this project actually is, not just what's
      // in front of it.
      context:
        'A blog and events site for a small editorial team, published under posts, authors, and events.',
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
        assetIssues({
          // Deliberately far below every default. This dataset's largest
          // asset is ~1.1 MB and `fixtures/example-press-kit.pdf` is ~17 KB,
          // so real ceilings (5 MiB images, 15 MiB PDFs) would make the
          // oversized check — and the navigation hanging off it —
          // unreachable in this workspace. Set per kind rather than as one
          // number so this config also demonstrates the option's real shape.
          maxSizeBytes: {image: 500_000, pdf: 10_000, audio: 10_000, other: 10_000},
          // An author's portrait is a picture of that author, so their own
          // name is the correct alt text — free, instant, and bulk-able.
          // `post.heroImage` and `event.coverImage` deliberately stay out of
          // this: a hero image is not a picture of its headline.
          altFromTitle: ['author.portrait', 'cocktail.photo'],
          // Stands in for a real vision model, so the per-row paid path is
          // reachable in this workspace without wiring up an API key. The
          // point being exercised is *when* this is called, not what it says.
          describeImage: async ({documentType, fieldName}) =>
            `A photograph illustrating this ${documentType}'s ${fieldName}`,
        }),
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
