import {Box, Card, Flex, Stack, Text} from '@sanity/ui'
import {type ReactNode} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

interface SectionCardProps {
  title?: string
  /** Rendered at the right of the header — a count, usually. */
  badge?: ReactNode
  /** Short note beside the title saying whose items these are. */
  note?: string
  /** Rendered under the header, above the body. Used for the selection bar. */
  toolbar?: ReactNode
  /**
   * An error the source reported in its result, as opposed to one it threw.
   * Passed in rather than thrown by the caller, because a caller that throws
   * does so *above* this component — see `BoundedSection` in `Inbox.tsx`,
   * which wraps `InboxSection` (the component that calls `source.useItems()`)
   * in an error boundary and renders a `SectionCard` like this one, with the
   * caught error, as its fallback.
   */
  error?: Error
  children: ReactNode
}

/**
 * The card one inbox source's items live in.
 *
 * This card does not itself isolate a throwing source from its neighbours —
 * that boundary lives one layer out, in `Inbox.tsx`, around whatever calls
 * `source.useItems()`. By the time this component renders, a throw has
 * already happened or it hasn't; either way it has nothing to catch here.
 * What this component does own is the `error` prop path: a source that
 * *reports* an error in its result, rather than throwing one.
 */
export function SectionCard(props: SectionCardProps) {
  const {title, badge, note, toolbar, error, children} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  return (
    // `overflow: hidden` so the header's own square-cornered background is
    // clipped by this card's radius instead of bleeding past it.
    <Card border overflow="hidden" radius={3} shadow={0}>
      {title && (
        // `minHeight` matches `MergedList`'s own actions/toolbar row
        // exactly (confirmed live: 58px at its normal, single-row height)
        // — both columns' own cards start at the same `top`, so a shorter
        // header here reads as misaligned even though nothing is actually
        // wrong with either card's own position. This card has no toolbar
        // of its own to grow for, so the height is pinned explicitly
        // instead. Re-measure and update this constant if that row's own
        // content ever changes height again (it did once already, when
        // Summarize/Suggest todos/Find content gaps were grouped behind
        // one "AI insights" menu). Only ever matches that row's *single-line*
        // height — once it wraps to two rows on a narrow screen, this
        // static card no longer tracks it; a real fix for that would need
        // live cross-column measurement, not a pinned constant.
        <Card
          borderBottom
          paddingX={3}
          paddingY={3}
          radius={0}
          // `display: flex` + `alignItems: center` on the card itself, not
          // just on the `Flex` inside it: `minHeight` alone left the inner
          // `Flex` at its own content height, sitting at the card's top
          // instead of centered in the extra room `minHeight` now reserves.
          style={{alignItems: 'center', display: 'flex', minHeight: 58}}
          tone="transparent"
        >
          {/* `paddingLeft={2}` here, on top of this Card's own `padding={3}`
              — a row's checkbox carries this same extra padding
              (`InboxRow.tsx`'s own checkbox wrapper), which this
              single-layer header doesn't otherwise have. The theme's
              spacing scale has no step between `3` and `4` that lines up
              with it, so it's added as an explicit inner `paddingLeft`
              rather than by bumping the Card's own padding a full step —
              `2`, not the `1` that lined up the plain checkbox below,
              since the icon's own glyph sits slightly inset from its
              bounding box at this size. */}
          <Flex align="center" flex={1} gap={3} paddingLeft={2}>
            <Box flex={1}>
              <Flex align="center" gap={2}>
                <Text size={1} textOverflow="ellipsis" weight="semibold">
                  {title}
                </Text>
                {note && (
                  <Text muted size={0}>
                    {note}
                  </Text>
                )}
              </Flex>
            </Box>
            {badge}
          </Flex>
        </Card>
      )}

      {toolbar}

      {error ? (
        <Box padding={3}>
          <Stack gap={3}>
            <Text size={1} weight="medium">
              {t('source.error.title')}
            </Text>
            <Text muted size={1}>
              {error.message}
            </Text>
          </Stack>
        </Box>
      ) : (
        children
      )}
    </Card>
  )
}
