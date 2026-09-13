import {Fragment} from 'react'
import {definePlugin, type NavbarProps} from 'sanity'

import {useSpikeDraftsCount} from './useSpikeDraftsCount'

/**
 * Plan 011 spike, mechanism 2: `studio.components.navbar`, the sibling slot
 * to `createActiveToolLayout.tsx`'s `activeToolLayout` override (see
 * `plans/011-investigate-nav-badge.md`).
 *
 * `StudioComponentsPluginOptions.navbar?: ComponentType<NavbarProps>` and
 * `NavbarProps.renderDefault: (props: NavbarProps) => JSX.Element` — see
 * `node_modules/sanity/lib/useVirtualizerScrollInstance-DrjJlJI9.d.ts:7584`
 * and `:7633`. Composable, same pattern as `activeToolLayout`: render
 * Sanity's own navbar unchanged via `renderDefault(props)` and layer content
 * on top, rather than reimplementing the navbar.
 *
 * Unlike the `Tool.icon` mechanism in `navBadgeSpike.tsx`, this one is
 * guaranteed to mount — it isn't at the mercy of whether Sanity's `ToolMenu`
 * happens to render icons or text for the current tool count/viewport width.
 * Confirmed live in the running Studio: this badge's `count(...)` query does
 * fire (see this plan's Findings for the network-request evidence,
 * contrasted with the `Tool.icon` mechanism's query that never does).
 */
export const navbarBadgeSpike = definePlugin({
  name: 'test-studio/navbar-badge-spike',
  studio: {
    components: {
      navbar: function BadgedNavbar(props: NavbarProps) {
        const count = useSpikeDraftsCount()

        return (
          <Fragment>
            {props.renderDefault(props)}
            {count !== null && count > 0 && (
              // `position: fixed` deliberately sidesteps whatever stacking
              // context Studio's own navbar establishes (it's plausibly
              // itself `position: sticky`/`fixed` with its own z-index) —
              // pinning to the viewport corner is the crude-but-reliable way
              // to prove the badge paints at all in this throwaway spike.
              <span
                style={{
                  position: 'fixed',
                  top: 6,
                  left: 6,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 999,
                  background: '#cf3f52',
                  color: '#fff',
                  fontSize: 10,
                  lineHeight: '16px',
                  textAlign: 'center',
                  fontWeight: 700,
                  pointerEvents: 'none',
                  zIndex: 2147483647,
                }}
              >
                {count}
              </span>
            )}
          </Fragment>
        )
      },
    },
  },
})
