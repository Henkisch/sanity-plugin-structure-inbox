import {useClient} from 'sanity'
import {type InboxItem, type InboxSource} from 'sanity-plugin-structure-inbox'
import {useEffect, useState} from 'react'

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
export function unmemoizedCanary(): InboxSource {
  return {
    name: 'unmemoizedCanary',
    title: 'Unmemoized canary',
    placement: 'main',

    useItems() {
      const client = useClient({apiVersion: '2025-02-19'})
      const [rows, setRows] = useState<{_id: string; _type: string; _updatedAt: string}[]>([])

      useEffect(() => {
        let cancelled = false
        client
          .fetch<{_id: string; _type: string; _updatedAt: string}[]>(
            // Real content only: the plugin's own per-editor store documents
            // (`structureInbox.*`) are deliberately unregistered types that an
            // editor should never meet in a list — see AGENTS.md.
            '*[!(_id in path("drafts.**")) && !(_type match "structureInbox.*")] | order(_updatedAt desc)[0...3]{_id, _type, _updatedAt}',
          )
          .then((next) => {
            if (!cancelled) setRows(next)
            return undefined
          })
          .catch(() => undefined)

        return () => {
          cancelled = true
        }
      }, [client])

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
