import {DocumentsIcon} from '@sanity/icons/Documents'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {from, of} from 'rxjs'
import {catchError, map, startWith, switchMap} from 'rxjs/operators'
import {useClient, useCurrentUser, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'
import {filterAuthoredBy} from './authoredBy'

export interface UnpublishedDraftsOptions {
  /** Only list drafts untouched for at least this long. Defaults to 7 days. */
  olderThanDays?: number
  /** Cap on rows. Defaults to 10. */
  limit?: number
  /** Restrict to these document types. Defaults to every type in the schema. */
  types?: string[]
  title?: string
  /** Which column to render in. Defaults to `main` — these are the work. */
  placement?: InboxSource['placement']
  /**
   * Only list drafts this editor has actually worked on.
   *
   * Off by default: a draft left unpublished is usually the team's problem
   * rather than one person's, and anyone can pick it up. Turn it on to narrow
   * the list to your own unfinished work — it costs one extra request per
   * refresh, because authorship lives in the transaction log rather than on the
   * document.
   *
   * @defaultValue false
   */
  onlyMine?: boolean
}

interface DraftRow {
  _id: string
  _type: string
  _updatedAt: string
  title?: string
}

const QUERY = `*[
  _id in path("drafts.**") &&
  ($types == null || _type in $types) &&
  _updatedAt < $before
] | order(_updatedAt desc)[0...$limit]{
  _id, _type, _updatedAt,
  "title": coalesce(title, name, label, _id)
}`

/**
 * Drafts that have sat unpublished long enough to look forgotten.
 *
 * Deliberately plain GROQ over the Studio's own dataset: no addon dataset, no
 * internal store, nothing a future Studio release can move.
 *
 * Ticking one cannot publish it — publishing has validation, permissions and
 * side effects this pane has no business performing — so this source has no
 * `resolve`, and a tick reads as "stop showing me this".
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {
    olderThanDays = 7,
    limit = 10,
    types,
    title = 'Unpublished drafts',
    placement = 'main',
    onlyMine = false,
  } = options

  return {
    name: 'unpublishedDrafts',
    title,
    icon: DocumentsIcon,
    placement,
    audience: onlyMine ? 'mine' : 'everyone',

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()
      const currentUser = useCurrentUser()
      const userId = currentUser?.id

      const result$ = useMemo(() => {
        const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

        const toItem = (row: DraftRow): InboxItem => ({
          id: row._id,
          title: row.title || row._id,
          subtitle: schema.get(row._type)?.title || row._type,
          timestamp: row._updatedAt,
          intent: {
            type: 'edit',
            // The published id is what an `edit` intent expects; the draft is
            // what it opens.
            params: {id: row._id.replace(/^drafts\./, ''), type: row._type},
          },
        })

        return client.observable
          .fetch<DraftRow[]>(QUERY, {before, limit, types: types ?? null})
          .pipe(
            switchMap((rows) => {
              // Without a user there is nobody to filter by, so listing
              // everything beats listing nothing.
              if (!onlyMine || !userId || rows.length === 0) return of(rows)

              return from(
                filterAuthoredBy(
                  client,
                  rows.map((row) => row._id),
                  userId,
                ),
              ).pipe(map((mine) => rows.filter((row) => mine.has(row._id))))
            }),
            map((rows): InboxSourceResult => ({items: rows.map(toItem)})),
            startWith<InboxSourceResult>({items: [], loading: true}),
            catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
          )
      }, [client, schema, userId])

      return useObservable(result$, {items: [], loading: true})
    },
  }
}
