import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import type {SanityClient} from '@sanity/client'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {map} from 'rxjs/operators'
// Type-only: erased at compile time — see `upcomingReleases.ts`'s own note
// on why this stays a type-only import.
import type {useActiveReleases as UseActiveReleasesType} from 'sanity'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` below, same reasoning `openTasks.ts` already gives.
import {
  useClient,
  useCurrentUser,
  useTranslation,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'

import {API_VERSION, STRUCTURE_INBOX_NAMESPACE} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {optionalHook} from './capability'
import {liveQuery$} from './liveQuery'
import {classifyRelease, toneForAttention} from './releaseAttention'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

const RELEASE_INTENT = 'release'

/**
 * Strips the `_.releases.` prefix a release's own document id carries — see
 * `upcomingReleases.ts`'s own doc comment on this same helper. Doubles here
 * as this source's join key for document counts: the object
 * `useActiveReleases` returns has no bare-id field of its own (confirmed
 * empirically — see this plan's own Findings; `release.name`, which
 * `upcomingReleases.ts`'s own title fallback already assumes exists, is not
 * actually present on the real hook data), only `_id`, so this is the one
 * place to get the bare id from.
 */
const getReleaseIdFromReleaseDocumentId = optionalHook<(documentId: string) => string>(
  'getReleaseIdFromReleaseDocumentId',
  (documentId) => documentId,
)

type ReleasesState = ReturnType<typeof UseActiveReleasesType>

/** Stands in for `useActiveReleases` when Sanity does not export it — see `upcomingReleases.ts`. */
function useUnavailableReleases(): ReleasesState {
  return {data: [], loading: false, byId: new Map(), dispatch: () => {}}
}

// Resolved once at module scope — see `upcomingReleases.ts` for why.
const useReleases = optionalHook<() => ReleasesState>('useActiveReleases', useUnavailableReleases)

export interface NeedsAttentionOptions {
  /** Cap on rows. Defaults to 10. */
  limit?: number
  title?: string
}

/**
 * How many documents a release holds, live. Not present on the release
 * object itself (confirmed empirically — see this plan's own Findings), so
 * this counts version documents by their own id shape
 * (`versions.<releaseId>.<documentId>`) via `path()`, which matches by id
 * prefix rather than scanning every document — the same standard
 * `authoredBy.ts` holds itself to.
 *
 * One query for every currently-active release at once, not one per release:
 * `releaseIds.length` releases produce one round trip, not N.
 */
function useDocumentCounts(client: SanityClient, releaseIds: readonly string[]): Map<string, number> {
  const idsKey = useMemo(() => releaseIds.slice().sort().join(','), [releaseIds])

  const counts$ = useMemo(() => {
    if (releaseIds.length === 0) return of(new Map<string, number>())

    const query =
      '*[_type == "system.release" && name in $names]' +
      '{name, "count": count(*[_id in path("versions." + ^.name + ".**")])}'

    const readCounts$ = defer(() =>
      from(client.fetch<{name: string; count: number}[]>(query, {names: releaseIds})).pipe(
        map((rows) => new Map(rows.map((row) => [row.name, row.count]))),
      ),
    )

    // Listens broadly (any version document, any release) rather than
    // scoping to `releaseIds` — a release entering/leaving `data` between
    // listen events would otherwise need its own listener wired up and torn
    // down, for a subscription that costs nothing extra to keep broad.
    return liveQuery$(client, '*[_id match "versions.*"]', {}, readCounts$)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `idsKey` is the intentional dependency; `releaseIds` itself gets a new array identity every render.
  }, [client, idsKey])

  return useObservable(counts$, new Map<string, number>())
}

/**
 * Releases that are off track — overdue, empty with their scheduled time
 * close, or ageing with no date set at all — promoted into the main column
 * instead of sitting only in `upcomingReleases`'s ambient aside card. See
 * `releaseAttention.ts` for the actual classification and why each condition
 * gets its own tone.
 *
 * A separate source from `upcomingReleases`, not a mode on it: a source
 * declares exactly one `placement`, so one source cannot put its calm items
 * in `aside` and its alarming ones in `main` — and a Studio should be able to
 * take the nag without the ambient card, or the card without the nag.
 *
 * No `resolve`: running a release is a deliberate act with its own
 * confirmation and belongs in the Releases tool, the same reasoning
 * `upcomingReleases` already uses. A tick here only ever acknowledges.
 *
 * No AI anywhere in this source — every condition is a date comparison and a
 * count, both already fully certain.
 *
 * Offers `assign`, sharing the exact same assignment record
 * `upcomingReleases.ts` does (same shared `ASSIGNMENT_TYPE`, same target id —
 * a release's own `_id` — since a row here and a row there can be the same
 * release): a real gap otherwise, confirmed live — assigning the release via
 * `upcomingReleases`'s own aside card left this row's avatar a dead,
 * permanently-"Unassigned" placeholder with no click affordance at all,
 * which read as broken rather than simply not wired up.
 *
 * Scheduled *documents* as a mechanism separate from releases does not exist
 * in this Sanity version (confirmed empirically — no `schedule`-shaped
 * document type exists in a v6 dataset; scheduled publishing is entirely
 * releases), so there is no `documents` option here the way the plan this
 * source came from first considered — only releases.
 */
export function needsAttention(options: NeedsAttentionOptions = {}): InboxSource {
  const {limit = 10, title = 'Needs attention'} = options

  return {
    name: 'needsAttention',
    title,
    icon: WarningOutlineIcon,
    placement: 'main',
    // Off-track is the team's problem, not one editor's — same reasoning
    // `upcomingReleases` uses for its own releases.
    audience: 'everyone',

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      const {data, loading, error} = useReleases()
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
      const assignments = useAssignmentStore(client, ASSIGNMENT_TYPE)

      const assigneesById = useMemo(() => {
        const byId = new Map<string, {id: string; label: string; imageUrl?: string}>()
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

      const releaseIds = useMemo(
        () => data.map((release) => getReleaseIdFromReleaseDocumentId(release._id)),
        [data],
      )
      const counts = useDocumentCounts(client, releaseIds)

      const items = useMemo(() => {
        const now = Date.now()

        const rows: InboxItem[] = []
        for (const release of data) {
          const releaseId = getReleaseIdFromReleaseDocumentId(release._id)
          const scheduledAt = release.publishAt || release.metadata.intendedPublishAt || undefined
          const documentCount = counts.get(releaseId)

          const attention = classifyRelease(
            {
              state: release.state,
              scheduledAt,
              createdAt: release._createdAt,
              documentCount,
            },
            now,
          )
          if (!attention) continue

          const when = scheduledAt
            ? new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(
                new Date(scheduledAt),
              )
            : undefined

          const assignedTo = assignments.byTarget.get(release._id)
          const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined

          const row: InboxItem = {
            id: release._id,
            title: release.metadata.title || releaseId,
            subtitle:
              attention === 'ageingUndated'
                ? t('needsAttention.ageingUndated')
                : t(`needsAttention.${attention}`, {when}),
            timestamp: scheduledAt,
            changedAt: release._updatedAt,
            tone: toneForAttention(attention),
            intent: {
              type: RELEASE_INTENT,
              params: {id: releaseId},
            },
          }
          rows.push(assignee ? {...row, assignee} : row)
        }

        return rows.slice(0, limit)
      }, [data, counts, t, assignments.byTarget, assigneesById])

      const assign = useMemo(() => {
        if (!assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: async (item: InboxItem, assignedTo: string) => {
            await assignments.assign(item.id, assignedTo)
          },
          unassign: async (item: InboxItem) => {
            await assignments.unassign(item.id)
          },
        }
      }, [assignable, assignments])

      if (useReleases === useUnavailableReleases) {
        return {
          items: [],
          error: new Error(
            'Releases needing attention are unavailable: Sanity no longer exports useActiveReleases.',
          ),
        }
      }

      return {items, loading, error, assign}
    },
  }
}
