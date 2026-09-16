import {type SanityClient} from '@sanity/client'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {debounceTime, map, startWith, switchMap} from 'rxjs/operators'
import {useClient} from 'sanity'
import {type InboxItem, type InboxSource} from 'sanity-plugin-structure-inbox'

/**
 * Plan 026 spike: an `InboxSource` reading the proposal documents
 * `altTextProposals` (the scheduled Function) writes, with `assess` and
 * `resolve` implemented for real. See
 * `plans/mellow-weaving-cascade.md`'s "Findings — plan 026".
 *
 * Deliberately a throwaway prototype: reads `structureInbox.imageAltProposal`
 * directly with a locally-written listen-then-refetch query (the same shape
 * `src/inbox/sources/liveQuery.ts`'s `liveQuery$` wraps — not importable
 * here, since it isn't exported from the package's public `src/index.ts`;
 * see this plan's own Findings on `promptJson`/`describeRows` for the first
 * time this exact gap showed up).
 */

interface ProposalRow {
  _id: string
  targetId: string
  targetTitle: string | null
  fieldPath: string
  proposedAlt: string | null
  reason: string | null
  targetChangedAt: string | null
}

const QUERY = `*[_type == "structureInbox.imageAltProposal"]{_id, targetId, targetTitle, fieldPath, proposedAlt, reason, targetChangedAt}`

function useProposalItems(client: SanityClient): {items: InboxItem[]; loading?: boolean} {
  // `agent.action.transform` (see the Function) writes its result to the
  // *draft* of the proposal document by default — confirmed empirically,
  // not assumed — so this reads the `previewDrafts` perspective rather than
  // the plain published one, or a freshly-written `proposedAlt` would never
  // show up here at all.
  const draftsClient = useMemo(() => client.withConfig({perspective: 'previewDrafts'}), [client])

  const result$ = useMemo(() => {
    const fetch$ = draftsClient.observable.fetch<ProposalRow[]>(QUERY)
    return draftsClient.listen(QUERY, {}, {enableResume: true, events: ['mutation', 'welcome', 'reset']}).pipe(
      debounceTime(500),
      startWith(null),
      switchMap(() => fetch$),
      map((rows) => ({
        items: rows.map(
          (row): InboxItem => ({
            id: row._id,
            title: row.proposedAlt
              ? `Add alt text: "${row.proposedAlt}"`
              : 'Alt text proposal (pending description)',
            subtitle: row.targetTitle ?? row.targetId,
            timestamp: row.targetChangedAt ?? undefined,
            changedAt: row.targetChangedAt ?? undefined,
            intent: {type: 'edit', params: {id: row.targetId, type: 'post'}},
          }),
        ),
      })),
    )
  }, [draftsClient])

  return useObservable(result$, {items: [], loading: true})
}

/**
 * `test-studio/plugins/proposalsSpike.tsx`'s own `InboxSource`. Registered
 * directly in `structureInbox({sources: [...]})` like any real source — see
 * `sanity.config.ts`'s `proposalsSpike` workspace.
 */
export function proposalsSpike(): InboxSource {
  return {
    name: 'proposalsSpike',
    title: 'Alt-text proposals (spike)',
    placement: 'main',
    useItems() {
      const client = useClient({apiVersion: '2025-02-19'})
      const result = useProposalItems(client)

      return {
        ...result,
        // The Function already wrote the reason a human needs — this never
        // calls Agent Actions a second time. Direct evidence for Question 4:
        // a stored sentence was enough, no second AI round-trip needed.
        assess: async (item: InboxItem) => {
          const proposal = await client
            .withConfig({perspective: 'previewDrafts'})
            .fetch<{reason: string | null} | null>(`*[_id == $id][0]{reason}`, {id: item.id})
          return {message: proposal?.reason ?? 'No reason recorded.'}
        },
        // Accepting patches the *target* document's own field — not a
        // publish, matching Decision 2 exactly — then removes the proposal.
        // Deletes both possible physical ids (draft and published) since the
        // proposal document might exist as either depending on whether an
        // editor has touched it in the Studio since the Function created it.
        resolve: async (item: InboxItem) => {
          const proposal = await client
            .withConfig({perspective: 'previewDrafts'})
            .fetch<ProposalRow | null>(`*[_id == $id][0]`, {id: item.id})
          if (!proposal || !proposal.proposedAlt) return

          await client.patch(proposal.targetId).set({[proposal.fieldPath]: proposal.proposedAlt}).commit()

          await client
            .transaction()
            .delete(proposal._id)
            .delete(`drafts.${proposal._id}`)
            .commit({visibility: 'async'})
        },
      }
    },
  }
}
