import {useCallback, useEffect} from 'react'
import {type ActiveToolLayoutProps} from 'sanity'
import {useRouter, useRouterState} from 'sanity/router'

import {HOME_PANE_ID} from '../constants'
import {isHomeAvailable} from '../structure/homeAvailability'
import {type ResolvedStructureHomeConfig} from '../types'
import {shouldRedirectToHome} from './shouldRedirectToHome'

/**
 * Builds the `studio.components.activeToolLayout` override that puts editors on
 * the Home pane when they land on the structure tool with nothing selected.
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
export function createActiveToolLayout(config: ResolvedStructureHomeConfig) {
  return function StructureHomeActiveToolLayout(props: ActiveToolLayoutProps) {
    const {activeTool} = props
    const {navigate} = useRouter()

    const panes = useRouterState(useCallback((state) => state.panes, []))
    const intent = useRouterState(useCallback((state) => state.intent, []))

    const activeToolName = activeTool.name

    useEffect(() => {
      const redirect = shouldRedirectToHome({
        redirectOnLanding: config.redirectOnLanding,
        // Read at effect time, not render time: the structure resolver runs
        // during the render of the tool this component wraps, so by the time
        // effects flush it has already reported whether injection worked.
        homeAvailable: isHomeAvailable(config.toolName),
        activeToolName,
        targetToolName: config.toolName,
        panes,
        intent,
      })

      if (!redirect) return

      // `replace` so the bare tool URL leaves no history entry — otherwise Back
      // out of Home would land on `/structure`, redirect again, and trap the
      // editor in the Studio.
      navigate({panes: [[{id: HOME_PANE_ID}]]}, {replace: true})
    }, [activeToolName, intent, navigate, panes])

    return props.renderDefault(props)
  }
}
