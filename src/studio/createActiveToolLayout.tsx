import {useCallback, useEffect, useSyncExternalStore} from 'react'
import {type ActiveToolLayoutProps} from 'sanity'
import {useRouter, useRouterState} from 'sanity/router'

import {INBOX_PANE_ID} from '../constants'
import {isInboxAvailable, subscribeInboxAvailability} from '../structure/inboxAvailability'
import {type ResolvedStructureInboxConfig} from '../types'
import {shouldRedirectToInbox} from './shouldRedirectToInbox'
import {useCollapsedLayout} from './useCollapsedLayout'

/**
 * Builds the `studio.components.activeToolLayout` override that puts editors on
 * the Inbox pane when they land on the structure tool with nothing selected.
 *
 * Why here, of all places: the structure tool resolves its panes straight from
 * the router, and at bare `/structure` there is exactly one pane — the root
 * list. Its `child` resolver is never called, so there is no "default child"
 * hook to render into the empty canvas. What does exist is a URL: give the
 * router one pane segment and the canvas fills itself through the ordinary
 * resolution path.
 *
 * `ActiveToolLayout` is rendered inside the active tool's `RouteScope`, so
 * `useRouterState` and `navigate` here speak the structure tool's own router —
 * `{panes}` — rather than the Studio's. That scoping is the whole reason this
 * override is the right seam and `layout` is not.
 */
export function createActiveToolLayout(config: ResolvedStructureInboxConfig) {
  return function StructureInboxActiveToolLayout(props: ActiveToolLayoutProps) {
    const {activeTool} = props
    const {navigate} = useRouter()

    const panes = useRouterState(useCallback((state) => state.panes, []))
    const intent = useRouterState(useCallback((state) => state.intent, []))

    const activeToolName = activeTool.name

    // A synchronous structure resolver has already reported whether injection
    // worked by the time this component's effects flush — the resolver runs
    // during the render of the tool this component wraps, which commits first.
    // An async resolver has not: it can still be pending on that first effect
    // run, and nothing else would re-trigger it once the promise settles. This
    // subscription is what makes a late `true` re-render and re-run the effect
    // below, instead of the redirect being silently missed.
    const inboxAvailable = useSyncExternalStore(subscribeInboxAvailability, () =>
      isInboxAvailable(config.toolName),
    )

    const collapsedLayout = useCollapsedLayout()

    useEffect(() => {
      const redirect = shouldRedirectToInbox({
        redirectOnLanding: config.redirectOnLanding,
        inboxAvailable,
        activeToolName,
        targetToolName: config.toolName,
        panes,
        intent,
        collapsedLayout,
      })

      if (!redirect) return

      // `replace` so the bare tool URL leaves no history entry — otherwise Back
      // out of Inbox would land on `/structure`, redirect again, and trap the
      // editor in the Studio.
      navigate({panes: [[{id: INBOX_PANE_ID}]]}, {replace: true})
    }, [activeToolName, collapsedLayout, inboxAvailable, intent, navigate, panes])

    return props.renderDefault(props)
  }
}
