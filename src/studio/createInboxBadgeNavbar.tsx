import {Badge} from '@sanity/ui'
import {Fragment} from 'react'
import {type NavbarProps} from 'sanity'

import {useInboxOpenCount} from './inboxCountLayout'

/**
 * Builds the `studio.components.navbar` override that shows a live "N things
 * waiting" badge — the same number the Inbox pane's own headline shows, via
 * `useInboxOpenCount()`, visible from anywhere in the Studio.
 *
 * `position: fixed` on the badge itself, not a wrapping positioned `Box`
 * around `renderDefault(props)` — a wrapping `Box` mounts and fetches
 * correctly but never paints visibly, because Studio's own navbar
 * establishes its own stacking context the wrapper cannot escape (confirmed
 * against a real running Studio while spiking this — see
 * `plans/017-nav-badge-production.md`). This composes with any other
 * plugin's own navbar override automatically, the same way
 * `createActiveToolLayout` already does for `activeToolLayout` — see
 * `test-studio/plugins/activeToolLayoutProbe.tsx` for this repo's own proof
 * that composition works with two overrides of the same slot stacked.
 */
export function createInboxBadgeNavbar() {
  return function InboxBadgeNavbar(props: NavbarProps) {
    const count = useInboxOpenCount()

    return (
      <Fragment>
        {props.renderDefault(props)}
        {count !== null && count > 0 && (
          <output
            aria-label={`${count} things waiting on you`}
            style={{position: 'fixed', top: 6, left: 6, zIndex: 2147483647, pointerEvents: 'none'}}
          >
            <Badge fontSize={0} radius={6} tone="critical">
              {count}
            </Badge>
          </output>
        )}
      </Fragment>
    )
  }
}
