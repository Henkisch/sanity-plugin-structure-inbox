import type {SanityClient} from '@sanity/client'
import {useMemo} from 'react'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`. `useCurrentUser` is a stable, public
// export, so a plain named import is fine, same as every source already does.
import {useCurrentUser} from 'sanity'

import {warnOnce} from '../../warnOnce'
import {type InboxItem, type InboxSourceResult} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {useAssignableUsers} from './capability'

/** The assignee map value every source built identically inline. */
export interface AssigneeInfo {
  id: string
  label: string
  imageUrl?: string
}

/** `InboxSourceResult['assign']`, narrowed to always-present (never `undefined`) — this is the shape `useAssignmentCapability` itself builds, not the optional field a source reports. */
export type AssignCapability = NonNullable<InboxSourceResult['assign']>

/**
 * `targetId` for the five sources whose own row id is already the id
 * `assignmentStore` should key on — `assetIssues`, `linkCheckerFindings`,
 * `needsAttention`, `unresolvedComments`, `upcomingReleases`. Confirmed by
 * reading each source's own pre-migration `assign` block, not inferred from
 * a sibling (see plan 085's own report).
 *
 * Module scope, not an inline arrow at the call site: this function closes
 * over nothing, so one shared reference keeps `useAssignmentCapability`'s
 * own `assign` memo stable across renders. An inline `(item) => item.id`
 * passed fresh every render would defeat that even though it computes the
 * same value — see this file's own note on `useAssignmentCapability` below.
 */
export const targetIdFromItemId = (item: InboxItem): string | undefined => item.id

/**
 * `targetId` for the two sources whose row id is a `drafts.`-prefixed
 * document id, not the id assignment should key on — `documentValidation`
 * and `unpublishedDrafts` both attach the canonical (unprefixed) id to
 * `item.intent.params.id` for exactly this reason. Same module-scope
 * reasoning as `targetIdFromItemId` above.
 */
export const targetIdFromIntentParamsId = (item: InboxItem): string | undefined => item.intent?.params.id

/**
 * The assignee map and the `assign` capability, shared by every built-in
 * source that offers assignment — extracted from eight near-identical
 * copies (see plan 085). `openTasks` is deliberately not one of them: it has
 * a real, native assignee field of its own and offers `assigneeReadOnly`
 * instead (see `InboxSourceResult.assigneeReadOnly`'s own doc comment) — its
 * `assigneesById` map is a shorter, unrelated duplication (no
 * `useAssignmentStore`, no `assign`), and routing it through this hook would
 * mean subscribing to a live assignment-store query it has no use for, off
 * the *wrong* dataset client at that (`openTasks` reads the Tasks addon
 * dataset, not the content dataset every other assignable source's `client`
 * is).
 *
 * `targetId` is **required and has no default**, on purpose. The eight
 * sources this replaces deliberately disagreed about which id to assign
 * against — five use `item.id` (`targetIdFromItemId`), two use
 * `item.intent?.params.id` (`targetIdFromIntentParamsId`), and each is
 * correct for its own source (a release's `item.id` is the release
 * *document* id; a draft's is `drafts.`-prefixed, so its assignment has to
 * key on the canonical id its own `intent` already carries). A default would
 * let a ninth source inherit the wrong one and silently assign the wrong
 * document — the same class of bug plan 060 hit with draft-prefixed ids in
 * an edit intent. Pass one of the two constants above, or a source's own
 * function, but never omit it.
 *
 * `targetId` returning `undefined` for a given item is a silent no-op on
 * `toUser`/`unassign` in the two sources that always passed it that way
 * before this hook existed — except it is no longer silent: it now warns
 * once, which those two sources' own pre-migration code did not. That is a
 * deliberate, small behaviour change (see plan 085's own report), not a
 * regression in what actually gets written.
 *
 * `assign` is referentially stable across a re-render with unchanged
 * inputs — asserted in this file's own test — which matters because it
 * flows through `SourceFeed`'s fingerprint machinery into `Inbox`'s own
 * state; an identity that churns every render is the "Maximum update depth
 * exceeded" class of bug `AGENTS.md` records three times over.
 */
export function useAssignmentCapability(
  client: SanityClient,
  options: {
    /** Which id this source's `assign` should write against. Required — see this function's own doc comment on why there is no default. */
    targetId: (item: InboxItem) => string | undefined
    /** Only two built-in sources have one (`unpublishedDrafts`, `unresolvedComments`) — pass a referentially-stable function (e.g. `useCallback`) so it does not itself churn `assign`'s identity. */
    suggestAssignee?: AssignCapability['suggestAssignee']
  },
): {
  assigneesById: Map<string, AssigneeInfo>
  /**
   * Every current assignment of this docType, keyed by target id — the same
   * `AssignmentStore.byTarget` `useAssignmentStore` itself returns, passed
   * through unchanged. Every source still needs this directly (not only
   * `assign`): joining `item.assignee` onto a freshly-built row happens
   * *while* that row is being constructed, before an `InboxItem` exists to
   * call `targetId` on, so the join has to read `byTarget` with whatever raw
   * id the row is being built from (`release._id`, `row._id`, a draft's own
   * canonical id) — the identical value `targetId` would compute from the
   * finished item, just read one step earlier.
   */
  byTarget: Map<string, string>
  assign: AssignCapability | undefined
} {
  const {targetId, suggestAssignee} = options

  const currentUser = useCurrentUser()
  const userId = currentUser?.id
  const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
  const assignments = useAssignmentStore(client, ASSIGNMENT_TYPE)

  const assigneesById = useMemo(() => {
    const byId = new Map<string, AssigneeInfo>()
    for (const user of assignable ?? []) {
      const isSelf = user.id === userId
      byId.set(user.id, {
        id: user.id,
        label: user.displayName || user.email || user.id,
        imageUrl: (isSelf && currentUser?.profileImage) || user.imageUrl,
      })
    }
    return byId
  }, [assignable, userId, currentUser])

  const assign = useMemo((): AssignCapability | undefined => {
    if (!assignable) return undefined

    const capability: AssignCapability = {
      users: assignable
        .filter((user) => user.granted)
        .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
      toUser: async (item: InboxItem, assignedTo: string) => {
        const id = targetId(item)
        if (!id) {
          warnOnce(
            'assign was called for an item with no resolvable target id — nothing was written.',
          )
          return
        }
        await assignments.assign(id, assignedTo)
      },
      unassign: async (item: InboxItem) => {
        const id = targetId(item)
        if (!id) {
          warnOnce(
            'unassign was called for an item with no resolvable target id — nothing was written.',
          )
          return
        }
        await assignments.unassign(id)
      },
    }
    if (suggestAssignee) capability.suggestAssignee = suggestAssignee
    return capability
  }, [assignable, assignments, targetId, suggestAssignee])

  return useMemo(
    () => ({assigneesById, byTarget: assignments.byTarget, assign}),
    [assigneesById, assignments.byTarget, assign],
  )
}
