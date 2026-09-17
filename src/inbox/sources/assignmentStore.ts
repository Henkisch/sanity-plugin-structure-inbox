import {type SanityClient} from '@sanity/client'
import {useMemo, useRef, useState} from 'react'
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
 * The one document type every assignable source's `assign` writes
 * through — shared, not per-source: `useAssignmentStore` below is already
 * generic over `docType`, and real Sanity ids never collide across a
 * draft, a release, an asset, or a comment (different id shapes
 * entirely), so there is no reason for each source to keep its own
 * private bookkeeping type. One shared type also means "everything
 * assigned to me" is one query away, not N separate ones unioned
 * together, if that's ever wanted.
 */
export const ASSIGNMENT_TYPE = 'structureInbox.assignment'

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
 * keep it current. Every built-in assignable source passes the same shared
 * `ASSIGNMENT_TYPE` here — `docType` stays a parameter (not a hardcoded
 * constant inside this function) only so a consumer's own custom source could
 * point it at a different type if it ever needed real isolation from the
 * built-in one. Never registered in the Studio schema, same reasoning
 * `useDismissals.ts` uses for its own preference doc: it is bookkeeping this
 * plugin owns, not content an editor should meet in the structure tool,
 * search, or a reference picker.
 *
 * Live rather than fetched once: someone assigning or unassigning elsewhere
 * should update every open tab without a navigate-away-and-back.
 *
 * The acting editor's own write is applied to `overrides` immediately,
 * rather than waiting on `client.listen`'s round trip through `byTarget$` —
 * a real, reported bug: without this, assigning sometimes silently needed a
 * manual reload before the row showed it, since everything depended on the
 * realtime listener firing promptly (or at all) for that exact mutation.
 * `useDismissals`/`useSnoozes`/`useTodos` already apply this same
 * optimistic-local-write-first principle for the acting editor's own
 * changes; this was the one piece of per-item state in the plugin that
 * didn't. `null` in `overrides` means "unassigned locally, awaiting the
 * live query's own confirmation" — without it, a still-stale remote row
 * would reappear the instant `unassign` resolves, before the listener
 * catches up. Each entry stops taking effect the moment `remoteByTarget`
 * itself agrees with what was written (see `byTarget`'s own comment below)
 * — not on any remote emission, which could stop overriding before the
 * specific write it's tracking is actually reflected — or immediately, if
 * the write itself rejects.
 */
export function useAssignmentStore(client: SanityClient, docType: string): AssignmentStore {
  const query = `*[_type == $docType && defined(assignedTo)]{targetId, assignedTo}`

  const byTarget$ = useMemo(() => {
    const params = {docType}
    const fetch$ = client.observable.fetch<AssignmentRow[]>(query, params)
    return liveQuery$(client, query, params, fetch$).pipe(
      map((rows) => new Map(rows.map((row) => [row.targetId, row.assignedTo]))),
      catchError(() => of(new Map<string, string>())),
    )
  }, [client, query, docType])

  const remoteByTarget = useObservable(byTarget$, new Map<string, string>())

  const [overrides, setOverrides] = useState(new Map<string, string | null>())

  // Pruned during render, not via a `setState`-in-effect — React's own
  // documented pattern for adjusting state in response to a changed value
  // (compare against a ref, and if it moved, call `setState` directly in
  // the render body; React discards this in-progress render and redoes it
  // with the new state before anything paints, rather than committing a
  // stale one first and correcting it in a second pass the way an effect
  // would). A `useEffect` here was tried and rejected: it only fires after
  // commit, so `byTarget` briefly renders including an override that
  // `remoteByTarget` had already resolved for one extra frame, and — the
  // real reason it matters, not merely cosmetic — an override left
  // unpruned indefinitely would keep masking a *later*, unrelated change
  // to the same key from someone else, since only an exact-match check
  // without ever removing the entry can't tell "remote hasn't caught up
  // yet" apart from "remote moved past this override to something new."
  const prevRemoteRef = useRef(remoteByTarget)
  // Reading/writing a ref during render (both flagged below) is exactly
  // React's own documented "adjusting state when a value changes" pattern
  // (compare against a ref, write it, conditionally call setState in the
  // same render), not the stale-closure hazard this rule is built to catch
  // — see the comment above for why an effect doesn't work here.
  // eslint-disable-next-line refs -- see comment above
  if (prevRemoteRef.current !== remoteByTarget) {
    // eslint-disable-next-line refs -- see comment above
    prevRemoteRef.current = remoteByTarget
    let pruned: typeof overrides | undefined
    for (const [targetId, expected] of overrides) {
      if ((remoteByTarget.get(targetId) ?? null) === expected) {
        pruned = pruned ?? new Map(overrides)
        pruned.delete(targetId)
      }
    }
    if (pruned) setOverrides(pruned)
  }

  const byTarget = useMemo(() => {
    if (overrides.size === 0) return remoteByTarget
    const merged = new Map(remoteByTarget)
    for (const [targetId, assignedTo] of overrides) {
      if (assignedTo === null) merged.delete(targetId)
      else merged.set(targetId, assignedTo)
    }
    return merged
  }, [remoteByTarget, overrides])

  return useMemo(
    () => ({
      byTarget,
      assign: async (targetId: string, assignedTo: string) => {
        setOverrides((current) => new Map(current).set(targetId, assignedTo))
        const docId = assignmentDocId(docType, targetId)
        try {
          await client
            .transaction()
            .createIfNotExists({_id: docId, _type: docType, targetId, assignedTo})
            .patch(docId, (patch) => patch.set({assignedTo}))
            .commit()
        } catch (error) {
          // Only roll back if this write's own value is still the one in
          // place — a second, later call to the same `targetId` (a quick
          // reassign, or assign-then-unassign) may have already overwritten
          // it with its own, still-in-flight optimistic value by the time
          // this `catch` runs. Deleting unconditionally would wipe out that
          // newer, still-pending write, reintroducing the exact "sometimes
          // needs a reload" bug this file exists to fix — just for the
          // narrower case of two overlapping writes to one target.
          setOverrides((current) => {
            if (current.get(targetId) !== assignedTo) return current
            const next = new Map(current)
            next.delete(targetId)
            return next
          })
          throw error
        }
      },
      unassign: async (targetId: string) => {
        setOverrides((current) => new Map(current).set(targetId, null))
        try {
          await client.delete(assignmentDocId(docType, targetId))
        } catch (error) {
          // Same reasoning as `assign`'s own catch above.
          setOverrides((current) => {
            if (current.get(targetId) !== null) return current
            const next = new Map(current)
            next.delete(targetId)
            return next
          })
          throw error
        }
      },
    }),
    [client, docType, byTarget],
  )
}
