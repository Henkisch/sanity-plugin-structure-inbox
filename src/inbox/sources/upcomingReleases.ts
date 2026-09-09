import {CalendarIcon} from '@sanity/icons/Calendar'
import {useMemo} from 'react'
import {useActiveReleases} from 'sanity'

import {type InboxItem, type InboxSource, type InboxSourceResult} from '../types'

export interface UpcomingReleasesOptions {
  /** Cap on rows. Defaults to 5. */
  limit?: number
  title?: string
  /** Which column to render in. Defaults to `aside` — releases are context. */
  placement?: InboxSource['placement']
}

/**
 * Releases that are scheduled or still being filled.
 *
 * A release is not something this pane can complete — publishing one is a
 * deliberate act with its own confirmation, and belongs in the Releases tool —
 * so there is no `resolve` here either. A tick means "I know about this one".
 *
 * `useActiveReleases` is `@internal` in Sanity's typings. It is the only way to
 * read releases without reimplementing their store, and it is confined to this
 * source: if it goes away, one source stops working rather than the plugin.
 */
export function upcomingReleases(options: UpcomingReleasesOptions = {}): InboxSource {
  const {limit = 5, title = 'Upcoming releases', placement = 'aside'} = options

  return {
    name: 'upcomingReleases',
    title,
    icon: CalendarIcon,
    placement,
    // A release is the same release for everybody looking at this Studio.
    audience: 'everyone',

    useItems(): InboxSourceResult {
      const {data, loading, error} = useActiveReleases()

      const items = useMemo(
        () =>
          data.slice(0, limit).map((release): InboxItem => {
            const scheduled = release.publishAt || release.metadata.intendedPublishAt

            return {
              id: release._id,
              title: release.metadata.title || release.name,
              subtitle: release.state,
              timestamp: scheduled,
              changedAt: release._updatedAt,
              // Scheduled releases are the ones with a deadline attached, so
              // they are the ones worth colouring.
              tone: release.state === 'scheduled' ? 'primary' : 'default',
            }
          }),
        [data],
      )

      return {items, loading, error}
    },
  }
}
