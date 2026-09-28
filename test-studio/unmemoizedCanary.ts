import {isDocumentSchemaType, useClient, useSchema} from 'sanity'
import {type InboxItem, type InboxSource} from 'sanity-plugin-structure-inbox'
import {useEffect, useMemo, useState} from 'react'

/**
 * A source written the way anyone would write one by hand, and the way the
 * README's own example used to: `items` built fresh inside `useItems`, with no
 * `useMemo` anywhere.
 *
 * That is a canary, deliberately left unmemoized. A new array identity every
 * render used to re-fire `SourceFeed`'s report effect on every render, which
 * re-rendered the pane, which rendered this again — an unbounded loop that
 * took a real customer's Structure tool down with "Maximum update depth
 * exceeded" before `useStableItems` absorbed it. If this workspace's Inbox
 * pane ever crashes that way again, this source is why, and that is the point:
 * nothing else here exercises the unmemoized case.
 */
/**
 * The project's own content types: registered, document-shaped, and not
 * Sanity's or a plugin's bookkeeping. The same rule the plugin's built-in
 * sources use (`getRealDocumentTypeNames`, not exported), restated here. A
 * source that lists "the newest documents" with no type filter surfaces
 * permission groups (`system.group`), assets, and unregistered plugin
 * documents like `linkCheckerReport` — none of which an editor should meet.
 */
const HIDDEN_PREFIXES = ['sanity.', 'system.', 'media.', 'structureInbox.']
const HIDDEN_NAMES = new Set(['translation.metadata'])

function useContentTypeNames(): string[] {
  const schema = useSchema()
  return useMemo(
    () =>
      schema
        .getTypeNames()
        .filter((name) => !HIDDEN_NAMES.has(name) && !HIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix)))
        .filter((name) => {
          const type = schema.get(name)
          return type !== undefined && isDocumentSchemaType(type)
        }),
    [schema],
  )
}

export function unmemoizedCanary(): InboxSource {
  return {
    name: 'unmemoizedCanary',
    title: 'Unmemoized canary',
    placement: 'main',

    useItems() {
      const client = useClient({apiVersion: '2025-02-19'})
      const types = useContentTypeNames()
      const [rows, setRows] = useState<{_id: string; _type: string; _updatedAt: string}[]>([])

      useEffect(() => {
        let cancelled = false
        client
          .fetch<{_id: string; _type: string; _updatedAt: string}[]>(
            // Real content only: see `useContentTypeNames` above.
            '*[_type in $types && !(_id in path("drafts.**"))] | order(_updatedAt desc)[0...3]{_id, _type, _updatedAt}',
            {types},
          )
          .then((next) => {
            if (!cancelled) setRows(next)
            return undefined
          })
          .catch(() => undefined)

        return () => {
          cancelled = true
        }
      }, [client, types])

      // Deliberately not memoized — see this source's own doc comment.
      const items: InboxItem[] = rows.map((row) => ({
        id: row._id,
        title: `Canary: ${row._id}`,
        subtitle: row._type,
        timestamp: row._updatedAt,
        changedAt: row._updatedAt,
        intent: {type: 'edit', params: {id: row._id, type: row._type}},
      }))

      return {items}
    },
  }
}

/**
 * The same canary as `unmemoizedCanary` above, but in the `aside` column
 * instead of `main`.
 *
 * `InboxSection.tsx` — the `aside` renderer — calls `source.useItems()`
 * directly with no `useStableItems` wrapping; `SourceFeed.tsx` (the `main`
 * renderer) is `useStableItems`' only caller. Plan 065's own `InboxSection`
 * test (`src/inbox/InboxSection.test.tsx`) covers this in vitest already and
 * found the aside column safe today for a structural reason — it reports
 * only `open.length`, a number, never the `items` array itself — but that is
 * exactly the kind of fact that stops being true silently if someone later
 * changes what `onCount` reports. This export is this workspace's own
 * from-scratch, this-columns's-own confirmation of the same thing: if an
 * unmemoized `aside` source ever does take a real Structure tool down, it
 * will be because that changed, and this is the fixture that would show it.
 */
export function unmemoizedAsideCanary(): InboxSource {
  const canary = unmemoizedCanary()
  return {
    ...canary,
    name: 'unmemoizedAsideCanary',
    title: 'Unmemoized canary (aside)',
    placement: 'aside',
  }
}
