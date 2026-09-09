import {Box, Button, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {type ComponentType, type ReactNode, useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_HOME_NAMESPACE} from '../constants'
import {WidgetErrorBoundary} from './WidgetErrorBoundary'

interface WidgetCardProps {
  title?: string
  icon?: ComponentType
  children: ReactNode
}

/**
 * The chrome every widget renders inside — the analogue of
 * `@sanity/dashboard`'s `DashboardWidgetContainer`.
 *
 * Widgets render their body here and never draw their own outer card, so the
 * pane stays visually consistent no matter who wrote the widget.
 *
 * The error boundary is per widget rather than per pane on purpose: one widget
 * with a bad GROQ query should cost the editor that one card, not the whole
 * Home screen.
 */
export function WidgetCard(props: WidgetCardProps) {
  const {title, icon: Icon, children} = props
  const {t} = useTranslation(STRUCTURE_HOME_NAMESPACE)
  const [error, setError] = useState<Error | null>(null)

  const handleRetry = useCallback(() => setError(null), [])

  return (
    <Card border radius={3} shadow={0} height="fill">
      {title && (
        <Card borderBottom padding={3} radius={0}>
          <Flex align="center" gap={2}>
            {Icon && (
              <Text muted size={1}>
                <Icon />
              </Text>
            )}
            <Heading size={0} textOverflow="ellipsis">
              {title}
            </Heading>
          </Flex>
        </Card>
      )}

      {error ? (
        <Box padding={3}>
          <Stack gap={3}>
            <Text muted size={1}>
              {t('widget.error.title')}
            </Text>
            <Text muted size={0}>
              {error.message}
            </Text>
            <Flex>
              {/* Ghost mode: recovering from an error is not the primary thing
                  on this pane, and a filled button would say otherwise. */}
              <Button
                fontSize={1}
                mode="ghost"
                onClick={handleRetry}
                text={t('widget.error.retry')}
              />
            </Flex>
          </Stack>
        </Box>
      ) : (
        <WidgetErrorBoundary onCatch={setError}>
          <Box padding={3}>{children}</Box>
        </WidgetErrorBoundary>
      )}
    </Card>
  )
}
