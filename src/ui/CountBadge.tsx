import {Badge, type BadgeTone} from '@sanity/ui'
import {type ReactNode} from 'react'

// No theme-provided monospace token exists in `@sanity/ui` today (confirmed:
// no `--card-code-font`-shaped CSS custom property, and `Text`'s own props
// have no `font` option) — a standard system monospace stack is the
// pragmatic, portable choice instead of depending on an undocumented
// internal.
export const COUNT_MONOSPACE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

interface CountBadgeProps {
  tone?: BadgeTone
  children: ReactNode
}

/**
 * The one shape every plain numeric count badge in this pane should use —
 * fixed size regardless of digit count, the number centered rather than
 * merely padded, and a monospace/tabular-width font so a count changing
 * from "1" to "8" doesn't read as the badge itself resizing (a proportional
 * font's digits aren't all the same width).
 *
 * Not used by `AssigneeOverflowMenu`'s own avatar-stack overflow chip
 * (`Inbox.tsx`) — that one is a real interactive `<button>` styled to match
 * the avatar stack it visually extends (border, overlap, z-index), not a
 * static badge; forcing it through this component would conflate two
 * different roles for the sake of one shared look. It applies this same
 * font choice directly instead — see its own comment.
 */
export function CountBadge({tone, children}: CountBadgeProps) {
  return (
    <Badge
      fontSize={0}
      padding={1}
      radius="full"
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '1.15em',
        justifyContent: 'center',
        minWidth: '1.15em',
      }}
      tone={tone}
    >
      {/* `Badge` wraps its own children in its own `Text`, which sets its own
          `font-family` — an inline style on the `Badge`/outer `Box` above
          doesn't reach past that. A `<span>` directly around the number,
          with its own inline style, takes precedence over that ancestor
          rule for this subtree specifically. */}
      <span
        style={{
          fontFamily: COUNT_MONOSPACE_FONT_FAMILY,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
        }}
      >
        {children}
      </span>
    </Badge>
  )
}
