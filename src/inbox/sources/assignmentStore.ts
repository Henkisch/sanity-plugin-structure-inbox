import {type SanityClient} from '@sanity/client'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {of} from 'rxjs'
import {catchError, map} from 'rxjs/operators'

import {liveQuery$} from './liveQuery'

/**
 * A plain, unregistered document mapping one target id to one assignee id —
 * how this plugin represents "who's on this" for anything with no native
 * Sanity assignee field of its own (an unpublished draft, a link-checker
 * finding). Deliberately not a Sanity Task: an earlier version of
 * `unpublishedDrafts.ts`'s own `assign` created a real `tasks.task` document
 * per assignment, which (a) surfaced as a second, separately-titled
 * "Follow up: …" row unrelated to the actual thing it was about, (b) needed
 * the addon dataset for a feature that has nothing to do with Sanity's own
 * Tasks concept, and (c) had a real, observed bug — reassigning something
 * that already had one of these tasks did not reliably find and reuse it,
 * so a fresh task was created on every single assign click. This plain doc
 * has none of that: one doc per assignment, in the content dataset the
 * source already reads, deleted outright on unassign.
 */
// Two independent djb2-family hashes of the same input, each base36-encoded
// and concatenated — cheap, dependency-free, and short regardless of input
// length. One hash alone (32 bits) collides too readily to trust blindly;
// two combined give a large enough space for this plugin's actual scale
// (at most a few thousand real targets per project) without pulling in a
// real hashing library for what is, in the end, an internal bookkeeping id
// nobody ever reads.
function hash32(input: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0
  }
  return hash >>> 0
}

/**
 * A target id can be anything a source finds meaningful — an unpublished
 * draft's own document id (short), but also a link-checker finding's key,
 * which embeds a real field path and, for a broken *link*, the entire URL.
 * Sanity document ids are capped at 128 characters; a raw, sanitized-in-place
 * URL blew straight through that limit and failed with "is not a valid
 * document ID" — confirmed live, not theoretical (a broken-link finding's
 * own assign failed silently in the console; a broken-*reference* finding's
 * short key stayed under the limit and worked, which is why this went
 * unnoticed at first). Hashing the target instead of sanitizing it in place
 * keeps every id short and valid regardless of what the target actually is.
 */
export function assignmentDocId(docType: string, targetId: string): string {
  return `${docType}.${hash32(targetId, 5381).toString(36)}${hash32(targetId, 52711).toString(36)}`
}

interface AssignmentRow {
  targetId: string
  assignedTo: string
}

export interface AssignmentStore {
  /** Every current assignment of this `docType`, keyed by `targetId`. */
  byTarget: Map<string, string>
  assign: (targetId: string, assignedTo: string) => Promise<void>
  unassign: (targetId: string) => Promise<void>
}

/**
 * Live map of every assignment of one `docType`, plus the two mutations that
 * keep it current. `docType` is this source's own private document type
 * (e.g. `structureInbox.draftAssignment`) — never registered in the Studio
 * schema, same reasoning `useDismissals.ts` uses for its own preference doc:
 * it is bookkeeping this plugin owns, not content an editor should meet in
 * the structure tool, search, or a reference picker.
 *
 * Live rather than fetched once: someone assigning or unassigning elsewhere
 * should update every open tab without a navigate-away-and-back.
 */
export function useAssignmentStore(client: SanityClient, docType: string): AssignmentStore {
  const query = `*[_type == "${docType}" && defined(assignedTo)]{targetId, assignedTo}`

  const byTarget$ = useMemo(() => {
    const fetch$ = client.observable.fetch<AssignmentRow[]>(query)
    return liveQuery$(client, query, {}, fetch$).pipe(
      map((rows) => new Map(rows.map((row) => [row.targetId, row.assignedTo]))),
      catchError(() => of(new Map<string, string>())),
    )
  }, [client, query])

  const byTarget = useObservable(byTarget$, new Map<string, string>())

  return useMemo(
    () => ({
      byTarget,
      assign: async (targetId: string, assignedTo: string) => {
        const docId = assignmentDocId(docType, targetId)
        await client
          .transaction()
          .createIfNotExists({_id: docId, _type: docType, targetId, assignedTo})
          .patch(docId, (patch) => patch.set({assignedTo}))
          .commit()
      },
      unassign: async (targetId: string) => {
        await client.delete(assignmentDocId(docType, targetId))
      },
    }),
    [client, docType, byTarget],
  )
}
