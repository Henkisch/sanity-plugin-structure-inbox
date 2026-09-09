import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {type ComponentType, type ReactNode, useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {SectionErrorBoundary} from './SectionErrorBoundary'

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
   * does so *above* this component and escapes the boundary below it.
   */
  error?: Error
  children: ReactNode
}

/**
 * The card one inbox source's items live in.
 *
 * The error boundary is per source rather than per pane on purpose: one source
 * with a bad query should cost the editor that one group, not their whole
 * inbox.
 */
export function SectionCard(props: SectionCardProps) {
  const {title, icon: Icon, badge, note, toolbar, error: reportedError, children} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const [caughtError, setCaughtError] = useState<Error | null>(null)

  const error = reportedError ?? caughtError

  const handleRetry = useCallback(() => setCaughtError(null), [])

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
        <SectionErrorBoundary onCatch={setCaughtError}>{children}</SectionErrorBoundary>
      )}
    </Card>
  )
}
