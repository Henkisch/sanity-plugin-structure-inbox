import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {type ComponentType, type ReactNode, useCallback} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

interface SectionCardProps {
  title?: string
  icon?: ComponentType
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
  const {title, icon: Icon, badge, note, toolbar, error, children} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  // A reported error comes back from the source's own hook on every render —
  // there is no local "caught" state here to clear, so retrying is only ever
  // meaningful if the source itself stops reporting one.
  const handleRetry = useCallback(() => {}, [])

  return (
    // `overflow: hidden` so the header's own square-cornered background is
    // clipped by this card's radius instead of bleeding past it.
    <Card border overflow="hidden" radius={3} shadow={0}>
      {title && (
        <Card borderBottom padding={3} radius={0} tone="transparent">
          <Flex align="center" gap={2}>
            {Icon && (
              <Text muted size={1}>
                <Icon />
              </Text>
            )}
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
            <Flex>
              {/* Ghost mode: recovering from an error is not the primary thing
                  on this pane, and a filled button would say otherwise. */}
              <Button
                fontSize={1}
                mode="ghost"
                onClick={handleRetry}
                text={t('source.error.retry')}
              />
            </Flex>
          </Stack>
        </Box>
      ) : (
        children
      )}
    </Card>
  )
}
