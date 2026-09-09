import {DocumentsIcon} from '@sanity/icons/Documents'
import {useMemo} from 'react'
import {useObservable} from 'react-rx'
import {of} from 'rxjs'
import {catchError, map, startWith} from 'rxjs/operators'
import {useClient, useSchema} from 'sanity'

import {API_VERSION} from '../../constants'
import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'

export interface UnpublishedDraftsOptions {
  /** Only list drafts untouched for at least this long. Defaults to 7 days. */
  olderThanDays?: number
  /** Cap on rows. Defaults to 10. */
  limit?: number
  /** Restrict to these document types. Defaults to every type in the schema. */
  types?: string[]
  title?: string
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
 * Deliberately plain GROQ over the studio's own dataset: no addon dataset, no
 * internal store, nothing that a future Studio release can move. Ticking one
 * cannot publish it — publishing has validation, permissions and side effects
 * this pane has no business performing — so this source has no `resolve`, and
 * a tick reads as "stop showing me this".
 */
export function unpublishedDrafts(options: UnpublishedDraftsOptions = {}): InboxSource {
  const {olderThanDays = 7, limit = 10, types, title = 'Unpublished drafts'} = options

  return {
    name: 'unpublishedDrafts',
    title,
    icon: DocumentsIcon,

    useItems(): InboxSourceResult {
      const client = useClient({apiVersion: API_VERSION})
      const schema = useSchema()

      const result$ = useMemo(() => {
        const before = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

        return client.observable
          .fetch<DraftRow[]>(QUERY, {before, limit, types: types ?? null})
          .pipe(
            map((rows): InboxSourceResult => ({
              items: rows.map((row): InboxItem => {
                const schemaType = schema.get(row._type)
                return {
                  id: row._id,
                  title: row.title || row._id,
                  subtitle: schemaType?.title || row._type,
                  timestamp: row._updatedAt,
                  intent: {
                    type: 'edit',
                    // The published id is what an `edit` intent expects; the
                    // draft is what it opens.
                    params: {id: row._id.replace(/^drafts\./, ''), type: row._type},
                  },
                }
              }),
            })),
            startWith<InboxSourceResult>({items: [], loading: true}),
            catchError((error: Error) => of<InboxSourceResult>({items: [], error})),
          )
      }, [client, schema])

      return useObservable(result$, {items: [], loading: true})
    },
  }
}
