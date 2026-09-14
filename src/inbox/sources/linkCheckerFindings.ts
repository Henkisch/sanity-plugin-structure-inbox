import {LinkRemovedIcon} from '@sanity/icons/LinkRemoved'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {defer, from, of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
import {useClient, useSchema} from 'sanity'
import {
  getFindingKey,
  readReport,
  REPORT_DOC_ID,
  type ScanFinding,
  type ScanResult,
} from 'sanity-plugin-link-checker/core'

import {API_VERSION} from '../../constants'
import {type SnoozeState} from '../../store/snoozes'
import {splitItems} from '../splitItems'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {liveQuery$} from './liveQuery'

export interface LinkCheckerFindingsOptions {
  /** Cap on rows shown, after filtering. Defaults to 50 — a report can carry far more findings than a pane should ever list at once. */
  limit?: number
  title?: string
  /** Which column to render in. Defaults to `main` — a broken link is work, not ambient context. */
  placement?: InboxSource['placement']
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
      tone: 'critical',
    }
  }

  return {
    ...base,
    title: finding.href,
    subtitle: `${typeTitle} · ${finding.fieldPath}`,
    // 'broken' is a confirmed dead link; 'unverifiable' (only ever present
    // here when `includeUnverifiable` is on) is a maybe — coloured less
    // urgently so it never reads as equally certain.
    tone: finding.result.status === 'broken' ? 'critical' : 'caution',
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

  const findings = report.findings.filter((finding) => {
    // Every reference finding is broken by construction — the plugin only
    // ever reports a reference once it has confirmed the target document is
    // gone (see `summarizeResult`'s own reasoning in that package).
    if (finding.kind === 'reference') return true
    if (finding.result.status === 'broken') return true
    return includeUnverifiable && finding.result.status === 'unverifiable'
  })

  return findings.slice(0, limit).map((finding) => toItem(finding, report.ranAt, schema))
}

/**
 * Broken links and dangling references, read from `sanity-plugin-link-checker`'s
 * own report document.
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
 * (its own Studio tool reads and writes it independently), a different
 * concept from this plugin's per-editor `dismissals`. Mixing the two would
 * mean one editor acknowledging a finding here silently changes what every
 * other editor sees in the link-checker tool itself, or vice versa. This
 * source's items are acknowledged the same way any other no-`resolve`
 * source's are: through this plugin's own dismissal store, visible only to
 * the editor who ticked it.
 *
 * Live rather than fetched once: `sanity-plugin-link-checker`'s report is
 * one always-overwritten document (`REPORT_DOC_ID`), so a re-scan run by
 * anyone — the in-Studio tool, the CLI, the Document Function — updates
 * this source without the editor navigating away and back.
 */
export function linkCheckerFindings(options: LinkCheckerFindingsOptions = {}): InboxSource {
  const {limit = 50, title = 'Broken link', placement = 'main', includeUnverifiable = false} = options

  function useFindingsFetch(): InboxSourceResult {
    const client = useClient({apiVersion: API_VERSION})
    const schema = useSchema()

    const result$ = useMemo(() => {
      // `sanity-plugin-link-checker` bundles its own `@sanity/client`
      // dependency rather than treating it as a peer, so its `SanityClient`
      // type and this package's are two structurally-identical but
      // nominally distinct classes (mismatched private fields) — a
      // TypeScript-only conflict; the actual client instance from
      // `useClient` is fully wire-compatible with what `readReport` expects.
      // eslint-disable-next-line no-unsafe-type-assertion -- see comment above: cross-package `SanityClient` type mismatch, same runtime object.
      const linkCheckerClient = client as unknown as Parameters<typeof readReport>[0]

      // `defer` so each re-subscription (one per listen event, via
      // `liveQuery$`'s own `switchMap`) calls `readReport` again instead of
      // replaying one cached Promise resolution forever — `readReport`
      // itself has no live-query form of its own, only this one-shot read.
      const fetch$ = defer(() => from(readReport(linkCheckerClient)))

      // The listen query only has to match the one report document closely
      // enough to fire on a re-scan — `liveQuery$` discards whatever this
      // returns and always refetches via `fetch$` above.
      const listenQuery = `*[_id == $id]`
      const params = {id: REPORT_DOC_ID}

      return liveQuery$(client, listenQuery, params, fetch$).pipe(
        map((report): InboxSourceResult => ({
          items: toItems(report, schema, includeUnverifiable, limit),
        })),
        startWith<InboxSourceResult>({items: [], loading: true}),
        catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
      )
    }, [client, schema])

    return useObservable(result$, {items: [], loading: true})
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
      const result = useFindingsFetch()

      return useMemo(() => {
        if (result.loading || result.error) return null
        return splitItems(result.items, 'linkCheckerFindings', snoozes, now).open.length
      }, [result, snoozes, now])
    },

    useItems(): InboxSourceResult {
      const result = useFindingsFetch()
      return result
    },
  }
}
