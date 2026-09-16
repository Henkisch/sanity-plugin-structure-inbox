import {useMemo} from 'react'
import {useRelativeTime} from 'sanity'

/**
 * Renders a timestamp the way the rest of the Studio does — "2 hours ago",
 * localized, and refreshing on its own — rather than a raw date string.
 */
export function RelativeTime({timestamp}: {timestamp: string}) {
  const date = useMemo(() => new Date(timestamp), [timestamp])
  const formatted = useRelativeTime(date, {minimal: true, useTemporalPhrase: true})
  return <>{formatted}</>
}
