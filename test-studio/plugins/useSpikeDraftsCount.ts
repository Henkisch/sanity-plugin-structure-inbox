import {useEffect, useState} from 'react'
import {useClient} from 'sanity'

const API_VERSION = '2024-01-01'

/**
 * Plan 011 spike: a simplified stand-in for `Inbox.tsx`'s `openCount`
 * (`src/inbox/Inbox.tsx:200-203`) — one source (unpublished drafts), no
 * snooze/dismiss/multi-source merge — shared by both candidate badge
 * mechanisms this spike tries (`navBadgeSpike.tsx`'s `Tool.icon` wrapper and
 * `navbarBadgeSpike.tsx`'s `studio.components.navbar` override), so the two
 * can be compared against the same live number.
 */
export function useSpikeDraftsCount(): number | null {
  const client = useClient({apiVersion: API_VERSION})
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const query = `count(*[_id in path("drafts.**")])`

    let cancelled = false

    const fetchCount = () => {
      client
        .fetch<number>(query)
        .then((result) => {
          if (!cancelled) setCount(result)
        })
        .catch(() => {
          if (!cancelled) setCount(null)
        })
    }

    fetchCount()

    // Query-scoped realtime listener — the same primitive `liveQuery$`
    // (`src/inbox/sources/liveQuery.ts`) wraps for the real sources, minus
    // the 500ms debounce (fine for a spike, one document at a time).
    const sub = client.listen(query).subscribe(() => fetchCount())

    return () => {
      cancelled = true
      sub.unsubscribe()
    }
  }, [client])

  return count
}
