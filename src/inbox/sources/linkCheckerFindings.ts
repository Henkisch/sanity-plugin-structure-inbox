import {LinkRemovedIcon} from '@sanity/icons/LinkRemoved'
import {SearchIcon} from '@sanity/icons/Search'
import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {Observable, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
// `useUserListWithPermissions` stays out of this named import — see
// `optionalHook` in `capability.ts`.
import {
  useClient,
  useCurrentUser,
  useSchema,
  type UserListWithPermissionsHookValue,
  type UserListWithPermissionsOptions,
} from 'sanity'
import {
  getFindingKey,
  isProblemFinding,
  observeReport,
  runScan,
  summarizeResult,
  type LinkCheckerPluginConfig,
  type ScanFinding,
  type ScanResult,
  writeReport,
} from 'sanity-plugin-link-checker/core'

import {promptJson} from '../../ai/promptJson'
import {useAgentClient} from '../../ai/useAgentClient'
import {API_VERSION} from '../../constants'
import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {
  type FixProposal,
  type InboxAssessment,
  type InboxItem,
  type InboxSource,
  type InboxSourceResult,
} from '../types'
import {ASSIGNMENT_TYPE, useAssignmentStore} from './assignmentStore'
import {optionalHook} from './capability'

/** Stands in for `useUserListWithPermissions` when Sanity does not export it — see `unpublishedDrafts.ts`. */
function useUnavailableUserList(): UserListWithPermissionsHookValue {
  return {data: null, error: null, loading: false}
}

// Resolved once at module scope — see `openTasks.ts` for why.
const useAssignableUsers = optionalHook<
  (opts: UserListWithPermissionsOptions) => UserListWithPermissionsHookValue
>('useUserListWithPermissions', useUnavailableUserList)

export interface LinkCheckerFindingsOptions {
  /** Cap on rows shown, after filtering. Defaults to 50 — a report can carry far more findings than a pane should ever list at once. */
  limit?: number
  /**
   * Row category label (the "Link checker · Everyone" segment) — shared by
   * every finding this source produces regardless of `kind`, so it can't say
   * "Broken link"/"Broken reference" itself (that distinction already lives
   * in each item's own `title`/`subtitle` — see `toItem`). Defaults to
   * "Link checker" for exactly that reason.
   */
  title?: string
  /**
   * Which column to render in. Defaults to `main` — a broken link is a real
   * action point (sortable by urgency alongside tasks and drafts, and
   * acknowledgeable the same way anything else without `resolve` is),
   * not ambient context to glance at. `aside` sources get none of that:
   * `InboxSection.tsx` never gives them a bulk-select/acknowledge mechanism
   * at all, so a finding placed there would just sit, visible, until fixed
   * — the right choice for something like `upcomingReleases`, not for this.
   */
  placement?: InboxSource['placement']
  /**
   * Passed straight through to `runScan` when an editor clicks "Scan for
   * issues" — the same config shape `linkChecker(config)` itself
   * takes (concurrency, `excludeTypes`, `excludeUrls`, and the rest). Omit
   * to scan with every default.
   */
  scanConfig?: LinkCheckerPluginConfig
  /**
   * Also list `unverifiable` link findings (a CORS-limited in-Studio check
   * that couldn't reach a real verdict), not just confirmed-`broken` ones.
   *
   * Off by default: per `sanity-plugin-link-checker`'s own README, a
   * browser-only check "mostly come[s] back unverifiable rather than a real
   * answer" without its Document Function deployed — including these by
   * default would flood the inbox with noise that isn't actually confirmed
   * broken. Turn this on once that Function is deployed, or if the noise is
   * acceptable for your project.
   *
   * @defaultValue false
   */
  includeUnverifiable?: boolean
  /**
   * Tooltip on the "Scan for issues" button, explaining what a scan actually
   * covers — the label alone doesn't say it scans the whole dataset for both
   * broken external links and dangling references. Override per project if
   * `scanConfig` narrows what's actually being scanned (e.g. `excludeTypes`),
   * so the tooltip keeps matching real behavior.
   */
  actionDescription?: string
}

const DEFAULT_ACTION_DESCRIPTION =
  'Scans every document in the dataset for broken external links and references to deleted documents.'

/** A plain top-level field name — no `[index]`/`.nested` — the only shape `singleReferenceTargetType` below knows how to resolve or `proposeFix` knows how to patch. */
const SIMPLE_FIELD_PATH = /^[a-zA-Z0-9_]+$/

/**
 * The one document type a broken reference's own field could point back
 * to, if (and only if) that's actually knowable: `fieldPath` has to name a
 * plain top-level field (not one buried in an array or Portable Text
 * marks — `sanity-plugin-link-checker`'s own `fieldPath` is a *display*
 * string, e.g. `richText[10].markDefs[1].customLink`, not something this
 * can safely turn into a patch path), and that field's schema has to
 * declare exactly one `to` type. A field with several possible `to` types
 * has no single answer for "what type of candidate should Agent Actions
 * even look at" — asking it to guess the type too, on top of the specific
 * document, is a second judgment call this plugin isn't taking on yet.
 *
 * Returns `undefined` for every case this can't handle — the caller (both
 * `toItem`, for `InboxItem.fixable`, and `proposeFix` itself) treats that
 * as "nothing to propose here," never as an error.
 */
function singleReferenceTargetType(
  schema: ReturnType<typeof useSchema>,
  fromType: string,
  fieldPath: string,
): string | undefined {
  if (!SIMPLE_FIELD_PATH.test(fieldPath)) return undefined

  const objectType = schema.get(fromType)
  if (!objectType || !('fields' in objectType)) return undefined

  const field = objectType.fields.find((candidate) => candidate.name === fieldPath)
  const fieldType = field?.type
  if (!fieldType || !('to' in fieldType)) return undefined

  const to = fieldType.to
  if (!Array.isArray(to) || to.length !== 1) return undefined

  return to[0]?.name
}

/**
 * Whether a broken *link* finding's `fieldPath` names a plain top-level
 * string/text field — the one shape `proposeFix` below can safely strip a
 * dead URL out of by itself. `jsonType === 'string'` (not `field.type.name`)
 * is what actually distinguishes this: a project could name a custom type
 * `'blurb'` that still compiles down to a plain string, and this should
 * still catch it. A broken link buried in Portable Text (a `markDefs` link
 * annotation) is a different, harder shape — real path construction into a
 * specific block/mark, not a plain field `set` — and isn't handled here; see
 * `singleReferenceTargetType`'s own doc comment for why a display-only,
 * possibly-nested `fieldPath` can't safely become a patch path in general.
 */
function singleTextFieldEligible(
  schema: ReturnType<typeof useSchema>,
  fromType: string,
  fieldPath: string,
): boolean {
  if (!SIMPLE_FIELD_PATH.test(fieldPath)) return false

  const objectType = schema.get(fromType)
  if (!objectType || !('fields' in objectType)) return false

  const field = objectType.fields.find((candidate) => candidate.name === fieldPath)
  return field?.type.jsonType === 'string'
}

function toItem(finding: ScanFinding, fallbackChangedAt: string, schema: ReturnType<typeof useSchema>): InboxItem {
  const typeTitle = schema.get(finding.fromType)?.title || finding.fromType
  // A finding carries no timestamp of its own — `docStateUpdatedAt` is the
  // *document's* last edit, the closest thing to "when did this become
  // stale" this plugin can show. Falls back to the scan's own `ranAt` for a
  // finding whose containing document reports neither (an older cached
  // report, before this field existed).
  const changedAt = finding.docStateUpdatedAt?.draft ?? finding.docStateUpdatedAt?.published ?? fallbackChangedAt

  const base = {
    id: getFindingKey(finding),
    timestamp: changedAt,
    changedAt,
    intent: {type: 'edit' as const, params: {id: finding.fromId, type: finding.fromType}},
  }

  if (finding.kind === 'reference') {
    return {
      ...base,
      title: `Broken reference in ${finding.fieldPath}`,
      subtitle: typeTitle,
      category: 'Broken reference',
      tone: 'critical',
      fixable: Boolean(singleReferenceTargetType(schema, finding.fromType, finding.fieldPath)),
    }
  }

  return {
    ...base,
    title: finding.href,
    subtitle: `${typeTitle} · ${finding.fieldPath}`,
    category: 'Broken link',
    // 'broken' is a confirmed dead link; 'unverifiable' (only ever present
    // here when `includeUnverifiable` is on) is a maybe — coloured less
    // urgently so it never reads as equally certain.
    tone: finding.result.status === 'broken' ? 'critical' : 'caution',
    // Only a confirmed-dead link is offered a fix — stripping a merely
    // `unverifiable` one could be removing a link that's actually fine.
    fixable:
      finding.result.status === 'broken' &&
      singleTextFieldEligible(schema, finding.fromType, finding.fieldPath),
  }
}

/** Exported only for `linkCheckerFindings.test.ts` — the pure part of this source, same reasoning as `InboxRow.tsx`'s own `initials`. */
export function toItems(
  report: ScanResult | null,
  schema: ReturnType<typeof useSchema>,
  includeUnverifiable: boolean,
  limit: number,
): InboxItem[] {
  if (!report) return []

  // `isProblemFinding` is `sanity-plugin-link-checker`'s own "does this
  // count as a real issue" definition — routed through it rather than
  // re-checking `.kind`/`.result.status` here, so this never quietly
  // drifts from what that package's own CLI gate (`summarizeResult`) means
  // by "broken".
  const findings = report.findings.filter((finding) => isProblemFinding(finding, {includeUnverifiable}))

  return findings.slice(0, limit).map((finding) => toItem(finding, report.ranAt, schema))
}

/**
 * Broken links and dangling references, read from `sanity-plugin-link-checker`'s
 * own report document — and, via this source's own `action` ("Scan for
 * issues", rendered next to `AddMenu` on the pane's tab row — see
 * `Inbox.tsx`), able to run a fresh scan itself rather than only ever
 * reading one someone ran elsewhere. This plugin never
 * needs its Studio tool mounted at all: `runScan`/`writeReport` (the exact
 * engine that tool's own "Run scan" button calls) are exported from its
 * headless `core` for precisely this — an editor never has to leave the
 * Inbox, or know link-checker has its own separate tool, to get a scan.
 * `linkChecker()`'s Studio tool, its CLI, and a deployed Document Function
 * remain equally valid ways to (re-)run one; this is simply a fourth,
 * available from right where the findings already show up.
 *
 * A separate, opt-in entry point (`sanity-plugin-structure-inbox/link-checker`),
 * not part of this package's main export — `sanity-plugin-link-checker` is a
 * peer dependency of that entry point, not of the whole plugin, so a Studio
 * that never uses link checking never pays for it. See that file's own doc
 * comment for why.
 *
 * No `resolve`: confirming a link is actually fixed means re-running that
 * plugin's own scan, which is its job, not this pane's — same reasoning as
 * `unpublishedDrafts` not publishing a draft itself. A tick here only ever
 * acknowledges (see `useDismissals`), the same as any other source with
 * nothing this plugin can verify.
 *
 * Also why this never sets `InboxItem.cleared`: unlike a task's own
 * `status`, there is no persisted "this finding is now confirmed fixed" flag
 * to read — a fixed link's finding simply stops appearing in the next
 * scan's `findings` array, the same way a published draft's `drafts.<id>`
 * document just stops existing. Cleared cannot mean anything for a source
 * shaped like this one (see `splitItems.ts`).
 *
 * Deliberately ignores the report's own `acknowledgedKeys` — that is
 * `sanity-plugin-link-checker`'s *own* shared, project-wide "reviewed" mark
 * (its own Studio tool reads and writes it independently, via that
 * package's own `isAcknowledged`/`toggleAcknowledged`), a different concept
 * from this plugin's per-editor `dismissals`. Mixing the two would mean one
 * editor acknowledging a finding here silently changes what every other
 * editor sees in the link-checker tool itself, or vice versa. This source's
 * items are acknowledged the same way any other no-`resolve` source's are:
 * through this plugin's own dismissal store, visible only to the editor who
 * ticked it.
 *
 * Also offers `assess` — the same Sanity Agent Actions call
 * `unpublishedDrafts.ts` uses for its own "Ask AI", applied to a finding
 * instead of a draft: one short, specific sentence suggesting what to do
 * about a broken reference or link. Deliberately only this judgment layer,
 * never the detection itself — a reference's existence and a link's
 * reachability are both already fully deterministic (a real GROQ existence
 * check; a real HTTP request), and handing either to an LLM would be
 * strictly worse on every axis: slower, non-free, and non-deterministic
 * where the real answer already has no ambiguity at all. Agent Actions also
 * has no general "fetch an arbitrary URL" capability to begin with, so a
 * broken *link* finding's own reachability could not be re-derived by the
 * AI even in principle — only a human, or `runScan` itself, can re-check
 * that. `assess` here only ever explains/suggests, on top of a finding
 * `runScan` already produced.
 *
 * Live rather than fetched once: `sanity-plugin-link-checker`'s own
 * `observeReport` (its report is one always-overwritten document) re-emits
 * whenever a re-scan writes a fresher one — run by anyone, the in-Studio
 * tool, the CLI, or the Document Function — so this updates without the
 * editor navigating away and back.
 */
export function linkCheckerFindings(options: LinkCheckerFindingsOptions = {}): InboxSource {
  const {
    limit = 50,
    title = 'Link checker',
    placement = 'main',
    scanConfig,
    includeUnverifiable = false,
    actionDescription = DEFAULT_ACTION_DESCRIPTION,
  } = options

  /**
   * The report itself rides alongside the mapped `InboxSourceResult` (not
   * exposed on the result — that's `InboxItem[]`, not raw findings) so
   * `useItems()` can look a finding back up by its key for `assess` below,
   * without a second, duplicate subscription to the same report document.
   */
  interface FindingsFetch {
    result: InboxSourceResult
    report: ScanResult | null
  }

  function useFindingsFetch(): FindingsFetch {
    const client = useClient({apiVersion: API_VERSION})
    const schema = useSchema()

    const fetch$ = useMemo(() => {
      // `observeReport` is a plain subscribe-callback API (not an
      // Observable of its own) - bridged into one here so this source
      // composes with the rest of this codebase's rxjs-based sources the
      // same way. Its own return value is already the teardown/unsubscribe
      // function `Observable`'s subscriber callback expects. Re-emits
      // whenever a re-scan writes a fresher report — run by anyone, the
      // in-Studio tool, the CLI, or the Document Function.
      const report$ = new Observable<ScanResult | null>((subscriber) =>
        observeReport(client, (report) => subscriber.next(report)),
      )

      return report$.pipe(
        map((report): FindingsFetch => ({
          report,
          result: {items: toItems(report, schema, includeUnverifiable, limit)},
        })),
        startWith<FindingsFetch>({report: null, result: {items: [], loading: true}}),
        catchError((error: Error) =>
          of<FindingsFetch>({report: null, result: {items: [], error}}),
        ),
      )
    }, [client, schema])

    return useObservable(fetch$, {report: null, result: {items: [], loading: true}})
  }

  return {
    name: 'linkCheckerFindings',
    title,
    icon: LinkRemovedIcon,
    placement,
    // No natural owner — a broken link is the team's problem, not one
    // editor's, the same reasoning `unpublishedDrafts` uses by default.
    audience: 'everyone',

    useOpenCount(snoozes: SnoozeState, now: number): number | null {
      const {result} = useFindingsFetch()

      return useMemo(() => {
        if (result.loading || result.error) return null
        return splitItems(result.items, 'linkCheckerFindings', snoozes, now).open.length
      }, [result, snoozes, now])
    },

    useItems(): InboxSourceResult {
      const {result, report} = useFindingsFetch()
      const client = useClient({apiVersion: API_VERSION})
      const agentClient = useAgentClient()
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id
      // `null` documentValue: not scoped to one finding, since any of them
      // could be assigned — every project member able to update documents is
      // a sensible assignee, same reasoning `unpublishedDrafts.ts` uses.
      const {data: assignable} = useAssignableUsers({documentValue: null, permission: 'update'})
      const assignments = useAssignmentStore(client, ASSIGNMENT_TYPE)

      // Runs the actual scan (`runScan`, the same engine the standalone
      // plugin's own "Run scan" button and CLI call) and persists it
      // (`writeReport`) — both exported from that plugin's headless `core`
      // for exactly this. The freshly-written report reaches this source
      // through the live `observeReport`-equivalent listen above like any
      // other re-scan would (the CLI's, another editor's, a deployed
      // Document Function's) — nothing here refreshes `items` directly.
      // Returns a one-line summary — the same distinct-problem counts
      // `summarizeResult` already gives the CLI and this source's own
      // acknowledged-findings filter, so this reads exactly as many issues
      // as the row list below would show. `action.run`'s return becomes the
      // inbox pane's own result card (`Inbox.tsx`), the same "insight" a
      // click on Summarize/Suggest todos already produces — a scan used to
      // give no feedback at all beyond the button's own pending state.
      const runFromInbox = useCallback(async () => {
        const scanResult = await runScan(client, scanConfig ?? {}, 'browser')
        await writeReport(client, scanResult)

        const {issueCount, brokenLinks, brokenRefs} = summarizeResult(scanResult)
        if (issueCount === 0) return 'No issues found.'
        const parts: string[] = []
        if (brokenLinks > 0) parts.push(`${brokenLinks} broken link${brokenLinks === 1 ? '' : 's'}`)
        if (brokenRefs > 0) parts.push(`${brokenRefs} broken reference${brokenRefs === 1 ? '' : 's'}`)
        return `Found ${issueCount} issue${issueCount === 1 ? '' : 's'} (${parts.join(', ')}).`
      }, [client])

      // Same shape and reasoning as `unpublishedDrafts.ts`'s own
      // `assigneesById`: `assignable` has everyone's display name and photo
      // except a reliable one for the current user, whose own profile fills
      // that gap instead.
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

      const items = useMemo(
        () =>
          result.items.map((item): InboxItem => {
            const assignedTo = assignments.byTarget.get(item.id)
            const assignee = assignedTo ? assigneesById.get(assignedTo) : undefined
            return assignee ? {...item, assignee} : item
          }),
        [result.items, assignments.byTarget, assigneesById],
      )

      const assign = useMemo(() => {
        if (!assignable) return undefined

        return {
          users: assignable
            .filter((user) => user.granted)
            .map((user) => ({id: user.id, label: user.displayName || user.email || user.id})),
          toUser: (item: InboxItem, assignedTo: string) => assignments.assign(item.id, assignedTo),
          unassign: (item: InboxItem) => assignments.unassign(item.id),
        }
      }, [assignable, assignments])

      // Keyed the same way `toItem` derives `InboxItem.id` (`getFindingKey`),
      // so `assess` below can go from a clicked item straight back to the
      // real finding it came from — a `ScanFinding` carries the field path
      // and (for a link) the URL itself, neither of which the pared-down
      // `InboxItem` keeps, but both of which the AI needs to say anything
      // specific rather than generic.
      const findingsByKey = useMemo(() => {
        const byKey = new Map<string, ScanFinding>()
        for (const finding of report?.findings ?? []) byKey.set(getFindingKey(finding), finding)
        return byKey
      }, [report])

      // What `unpublishedDrafts.ts`'s own `assess` does for a draft, applied
      // to a finding instead: one short, specific sentence from Sanity's
      // Agent Actions, never a fix applied automatically — deliberately the
      // same "informational only" shape, since detection here is already
      // fully deterministic (see this source's own module-level notes on
      // why link-checker's actual scanning can't and shouldn't be handed to
      // an LLM); this is only ever the judgment layer on top of it.
      const assess = useMemo(() => {
        if (!agentClient) return undefined

        return async (item: InboxItem): Promise<InboxAssessment> => {
          const finding = findingsByKey.get(item.id)
          if (!finding) throw new Error('No finding found for this item — has it been rescanned?')

          const instruction =
            finding.kind === 'reference'
              ? `Given the following document:\n$document\n---\nField '${finding.fieldPath}' holds a reference to a document that no longer exists. In one short, specific sentence, suggest what to do about it.`
              : `Given the following document:\n$document\n---\nField '${finding.fieldPath}' holds a broken external link (${finding.href}). In one short, specific sentence, suggest what to do about it.`

          const message = await agentClient.agent.action.prompt({
            instruction,
            instructionParams: {document: {type: 'document', documentId: finding.fromId}},
          })

          // Severity here is already fully known — a reference finding is
          // broken by construction, a confirmed-broken link is a real
          // problem, an unverifiable one is a maybe (same distinction
          // `toItem`'s own `tone` already draws) — asking the model to also
          // judge how bad it is would just be re-deriving a fact this source
          // already has for certain.
          const tone = finding.kind === 'reference' || finding.result.status === 'broken' ? 'critical' : 'caution'

          return {message, tone}
        }
      }, [agentClient, findingsByKey])

      // The "action" half of "insight, then action" — see `proposeFix`'s own
      // doc comment on `InboxSourceResult`. Only ever offered when
      // `InboxItem.fixable` said so (the same `singleReferenceTargetType`
      // check, re-run here since a fresh `finding` lookup is needed anyway),
      // so a `null` return here is the rarer case: the shape looked
      // eligible, but Agent Actions itself found no confident candidate.
      //
      // The AI's only job is choosing *which* existing document fits —
      // `candidates` is a live GROQ list of everything of the target type,
      // handed to Agent Actions itself to embed (rather than fetched here
      // and stringified) so the instruction always reflects the current
      // dataset. The actual write, in `apply` below, is a plain
      // deterministic patch this code fully controls: the model never
      // decides *how* to mutate anything, only *which* id to use.
      // Unlike the reference fix above, a broken *link* has nothing for an
      // LLM to judge: the URL is already confirmed dead by a real HTTP
      // check (see this source's own module-level notes on why detection
      // itself is never handed to Agent Actions), so removing it from the
      // field is correct every time, not a candidate to weigh. `proposeFix`
      // still returns the same shape everything else does (a summary plus
      // an `apply`), just without an Agent Actions round-trip to get there —
      // "insight, then action" doesn't require the insight to come from an
      // AI call when there's no real judgment call being made.
      const proposeLinkFix = useCallback(
        async (finding: Extract<ScanFinding, {kind: 'link'}>): Promise<FixProposal | null> => {
          if (!singleTextFieldEligible(schema, finding.fromType, finding.fieldPath)) return null

          const current = await client.fetch<string | null>(
            `*[_id == $id][0].${finding.fieldPath}`,
            {id: finding.fromId},
          )
          // Not a string (field cleared, or `fieldPath` no longer resolves
          // the way it did at scan time), or the dead URL isn't even in
          // there anymore (already edited by hand since the scan) — either
          // way, nothing left for this to safely remove.
          if (typeof current !== 'string' || !current.includes(finding.href)) return null

          const updated = current.split(finding.href).join('').replace(/ {2,}/g, ' ').trim()

          return {
            summary: `Remove the broken link (${finding.href})`,
            apply: async () => {
              await client.patch(finding.fromId).set({[finding.fieldPath]: updated}).commit()
            },
          }
        },
        [client, schema],
      )

      const proposeFix = useCallback(
        async (item: InboxItem): Promise<FixProposal | null> => {
          const finding = findingsByKey.get(item.id)
          if (!finding) return null
          if (finding.kind === 'link') return proposeLinkFix(finding)
          if (finding.kind !== 'reference') return null

          if (!agentClient) return null

          const targetType = singleReferenceTargetType(schema, finding.fromType, finding.fieldPath)
          if (!targetType) return null

          const candidateCount = await client.fetch<number>('count(*[_type == $type])', {
            type: targetType,
          })
          if (candidateCount === 0) return null

          type FixChoice = {id: string | null; label: string | null; reason: string}

          const choice = await promptJson<FixChoice>(
            agentClient,
            "Given the following document:\n$document\n---\nField '" +
              finding.fieldPath +
              "' should hold a reference to a " +
              targetType +
              ' document, but the one it pointed to no longer exists. Here are the ' +
              targetType +
              ' documents that currently exist:\n$candidates\n---\n' +
              'Return JSON {"id": string or null, "label": string or null, "reason": string}: ' +
              '`id` is the _id of whichever candidate best fits this document given its own ' +
              "content, `label` is that candidate's own title/name, and `reason` is one short " +
              'sentence explaining the choice. If none of the candidates clearly fit, set `id` ' +
              'and `label` to null and use `reason` to say so.',
            {
              document: {type: 'document', documentId: finding.fromId},
              candidates: {
                type: 'groq',
                query: '*[_type == $type][0...20]{_id, "label": coalesce(title, name, _id)}',
                params: {type: targetType},
              },
            },
          )

          if (!choice?.id) return null

          const chosenId = choice.id
          return {
            summary: choice.reason ? `Replace with "${choice.label}" — ${choice.reason}` : `Replace with "${choice.label}"`,
            apply: async () => {
              await client
                .patch(finding.fromId)
                .set({[finding.fieldPath]: {_type: 'reference', _ref: chosenId}})
                .commit()
            },
          }
        },
        [agentClient, client, findingsByKey, proposeLinkFix, schema],
      )

      return useMemo(
        () => ({
          ...result,
          items,
          assign,
          assess,
          proposeFix,
          action: {
            label: 'Scan for issues',
            pendingLabel: 'Scanning…',
            run: runFromInbox,
            description: actionDescription,
            icon: SearchIcon,
          },
        }),
        [result, items, assign, assess, proposeFix, runFromInbox],
      )
    },
  }
}
