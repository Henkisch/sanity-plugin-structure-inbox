import {type ComponentType} from 'react'
import {definePlugin, type Tool} from 'sanity'

import {useSpikeDraftsCount} from './useSpikeDraftsCount'

/**
 * Plan 011 spike, mechanism 1: confirm whether a `Tool`'s `icon` can be a
 * React component that reads live state directly, as a smaller alternative
 * to overriding `studio.components.navbar` (see
 * `plans/011-investigate-nav-badge.md`).
 *
 * `Tool.icon` types as `ComponentType` (no props) — see
 * `node_modules/sanity/lib/useVirtualizerScrollInstance-DrjJlJI9.d.ts:7734`.
 * That's a real, mountable component: it runs its own hooks regardless of
 * being called with no props, so it can subscribe to live data on its own.
 * There is no `renderDefault`-style escape hatch here (unlike `NavbarProps`/
 * `ActiveToolLayoutProps`/`ToolMenuProps`), but none is needed: the plugin
 * already owns the value it's replacing (`target.icon`), so "compose with
 * the original" just means rendering the captured original component inside
 * the new wrapper — no cooperation from Studio required.
 *
 * MEASURED RESULT (see this plan's Findings): in `test-studio`'s own
 * `badgeSpike` workspace (two tools, full desktop width), Sanity's topbar
 * `ToolMenu` renders tool tabs as plain text and never invokes `tool.icon` at
 * all — confirmed by network-request capture showing this component's own
 * `count(...)` query never fires. This component is left in place, wired up
 * in `sanity.config.ts`, as the reproduction case for that finding.
 */
function createBadgedIcon(OriginalIcon: ComponentType | undefined): ComponentType {
  return function BadgedToolIcon() {
    const count = useSpikeDraftsCount()

    return (
      <span style={{position: 'relative', display: 'inline-flex'}}>
        {OriginalIcon ? <OriginalIcon /> : null}
        {count !== null && count > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              borderRadius: 999,
              background: 'var(--card-badge-tone-critical, #cf3f52)',
              color: '#fff',
              fontSize: 9,
              lineHeight: '14px',
              textAlign: 'center',
              fontWeight: 700,
            }}
          >
            {count}
          </span>
        )}
      </span>
    )
  }
}

/**
 * Wraps the `structure` tool's icon with `createBadgedIcon` — see
 * `sanity.config.ts`'s `badgeSpike` workspace.
 */
export const navBadgeSpike = definePlugin({
  name: 'test-studio/nav-badge-spike',
  tools: (prev) =>
    prev.map((tool): Tool => {
      if (tool.name !== 'structure') return tool
      return {...tool, icon: createBadgedIcon(tool.icon)}
    }),
})
