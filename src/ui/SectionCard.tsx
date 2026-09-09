import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {type ComponentType, type ReactNode, useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_HOME_NAMESPACE} from '../constants'
import {SectionErrorBoundary} from './SectionErrorBoundary'

interface SectionCardProps {
  title?: string
  icon?: ComponentType
  /** Rendered at the right of the header — a count, usually. */
  badge?: ReactNode
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
  const {title, icon: Icon, badge, children} = props
  const {t} = useTranslation(STRUCTURE_HOME_NAMESPACE)
  const [error, setError] = useState<Error | null>(null)

  const handleRetry = useCallback(() => setError(null), [])

  return (
    <Card border radius={3} shadow={0}>
      {title && (
        <Card borderBottom padding={3} radius={0} tone="transparent">
          <Flex align="center" gap={2}>
            {Icon && (
              <Text muted size={1}>
                <Icon />
              </Text>
            )}
            <Box flex={1}>
              <Text size={1} textOverflow="ellipsis" weight="semibold">
                {title}
              </Text>
            </Box>
            {badge}
          </Flex>
        </Card>
      )}

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
        <SectionErrorBoundary onCatch={setError}>{children}</SectionErrorBoundary>
      )}
    </Card>
  )
}
