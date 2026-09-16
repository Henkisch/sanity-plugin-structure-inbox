import {createClient} from '@sanity/client'
import {scheduledEventHandler} from '@sanity/functions'

/**
 * Plan 026 spike: a real, scheduled Sanity Function. Finds `post` documents
 * whose `heroImage` has no alt text, and for each writes one
 * `structureInbox.imageAltProposal` document — never patching the target
 * document itself. See `plans/mellow-weaving-cascade.md`'s "Findings — plan
 * 026" for the reasoning and what running this proved.
 *
 * Capped at 10 proposals per run, and skips any target that already has an
 * open proposal — an agent that fills an inbox with the same suggestion
 * every night has made the problem worse, which is the point Decision 2/the
 * plan's own Step 2 instruction exists to guard against.
 */

const MAX_PROPOSALS_PER_RUN = 10
const SCHEMA_ID = '_.schemas.default'
// A scheduled Function has no triggering document or dataset event, so —
// confirmed empirically (see Findings) — `context.clientOptions` never
// carries `projectId`/`dataset` the way a document-event Function's does,
// only `token` (and only that, when invoked with `--with-user-token`
// locally, or via the `robotToken` this plan's `sanity.blueprint.ts`
// attaches once deployed). A scheduled Function has to know its own project
// and dataset; there is nothing to infer them from.
const PROJECT_ID = 'efebqg67'
const DATASET = 'production'

interface MissingAltRow {
  _id: string
  _updatedAt: string
  title: string
  imageAssetRef: string
}

export const handler = scheduledEventHandler(async ({context}) => {
  const client = createClient({
    apiVersion: '2025-02-19',
    projectId: PROJECT_ID,
    dataset: DATASET,
    token: context.clientOptions?.token,
    useCdn: false,
  })
  // Agent Actions require `vX` specifically — same constraint `src/ai/
  // useAgentClient.ts` documents for the Studio side of this batch.
  const agentClient = client.withConfig({apiVersion: 'vX'})

  const alreadyProposedTargets: string[] = await client.fetch(
    `*[_type == "structureInbox.imageAltProposal"].targetId`,
  )

  const candidates: MissingAltRow[] = await client.fetch(
    `*[_type == "post" && defined(heroImage.asset) && !defined(heroImage.alt) && !(_id in $alreadyProposedTargets)]
      [0...$limit]{_id, _updatedAt, title, "imageAssetRef": heroImage.asset._ref}`,
    {alreadyProposedTargets, limit: MAX_PROPOSALS_PER_RUN},
  )

  console.log(`altTextProposals: ${candidates.length} candidate(s), ${alreadyProposedTargets.length} already proposed`)

  for (const row of candidates) {
    const proposal = await client.create({
      _type: 'structureInbox.imageAltProposal',
      targetId: row._id,
      targetTitle: row.title,
      fieldPath: 'heroImage.alt',
      targetChangedAt: row._updatedAt,
      reason: 'This image has no alt text for screen readers.',
      sourceImage: {_type: 'image', asset: {_type: 'reference', _ref: row.imageAssetRef}},
    })

    await agentClient.agent.action.transform({
      schemaId: SCHEMA_ID,
      documentId: proposal._id,
      instruction: 'Describe this image in one concise sentence suitable as alt text.',
      target: {
        path: ['proposedAlt'],
        operation: {type: 'image-description', sourcePath: ['sourceImage']},
      },
    })

    console.log(`altTextProposals: proposed alt text for ${row._id} as ${proposal._id}`)
  }
})
