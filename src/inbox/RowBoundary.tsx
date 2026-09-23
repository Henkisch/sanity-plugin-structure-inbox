import {Box, Card, Text} from '@sanity/ui'
import {type ReactNode} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {SectionErrorBoundary} from '../ui/SectionErrorBoundary'

function noop(): void {}

function RowFallback() {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  return (
    <Card padding={3} radius={2} tone="transparent">
      <Box>
        <Text muted size={1}>
          {t('row.renderFailed')}
        </Text>
      </Box>
    </Card>
  )
}

/**
 * One row's own failure domain: a row that throws while rendering is replaced
 * by a muted placeholder, and every row around it keeps rendering.
 *
 * The main column had no boundary below the pane at all — the one in
 * `Inbox.tsx` wraps the headless `SourceFeed`, not the rows `MergedList`
 * draws — so a single unrenderable title took down the whole Structure tool.
 * `SourceFeed`'s `normalizeItemText` removes the known cause; this is for the
 * next one.
 *
 * `resetKey` is the row's item: a source that fixes the data hands the row a
 * new item, which remounts it (within `SectionErrorBoundary`'s own reset
 * budget, so a row that throws on every item can't loop).
 *
 * @internal
 */
export function RowBoundary(props: {children: ReactNode; resetKey?: unknown}) {
  return (
    <SectionErrorBoundary
      fallback={<RowFallback />}
      label="inbox row threw"
      onCatch={noop}
      resetKey={props.resetKey}
    >
      {props.children}
    </SectionErrorBoundary>
  )
}
