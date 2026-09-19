import {useMediaIndex} from '@sanity/ui'

/**
 * Whether the structure tool is rendering as a single pane at a time.
 *
 * The structure tool collapses its pane layout when the layout element is
 * narrower than `theme.sanity.media[1]` (640px in the default studio theme),
 * and a collapsed layout only ever shows the *last* pane — every pane to its
 * left is in the DOM but hidden. That is what makes a landing redirect into
 * the Inbox pane a trap on a phone: the root list is still resolved, it just
 * cannot be seen or reached.
 *
 * Read through `useMediaIndex` rather than measuring the layout, because this
 * has to be answerable from *outside* the structure tool's own providers —
 * `activeToolLayout` wraps the tool, so `useStructureTool()`'s authoritative
 * `layoutCollapsed` is not in scope there. Media index 0 covers everything
 * below `media[0]` and index 1 covers `media[0]`–`media[1]`, so `< 2` is
 * exactly the tool's own `width < media[1]` rule expressed against the
 * viewport, for whatever breakpoints the theme defines. The two only
 * disagree when the tool is not the full width of the window, which the
 * structure tool never is.
 *
 * @internal
 */
export function useCollapsedLayout(): boolean {
  return useMediaIndex() < 2
}
