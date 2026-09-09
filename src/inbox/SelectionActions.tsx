import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

interface SelectionActionsProps {
  count: number
  /** True when the source can complete items where they actually live. */
  resolves: boolean
  /** How many of the selected rows are already done. */
  doneCount: number
  busy: boolean
  onResolve: () => void
  onDismiss: () => void
  onRestore: () => void
  onClear: () => void
}

/**
 * The bar that appears once rows are selected.
 *
 * Which buttons show depends on what is selected, so an editor is never offered
 * an action that would do nothing: only done rows can be put back, and only a
 * source that can complete items offers to complete them.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const {count, resolves, doneCount, busy, onResolve, onDismiss, onRestore, onClear} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const openCount = count - doneCount

  return (
    <Card borderBottom padding={2} radius={0} tone="primary">
      <Flex align="center" gap={2}>
        <Box flex={1} paddingLeft={2}>
          <Text size={1} weight="medium">
            {t('selection.count', {count})}
          </Text>
        </Box>

        {openCount > 0 && resolves && (
          <Button
            disabled={busy}
            fontSize={1}
            onClick={onResolve}
            padding={2}
            text={t('action.markDone')}
            tone="positive"
          />
        )}

        {openCount > 0 && (
          <Button
            disabled={busy}
            fontSize={1}
            mode="ghost"
            onClick={onDismiss}
            padding={2}
            text={t('action.dismiss')}
          />
        )}

        {doneCount > 0 && (
          <Button
            disabled={busy}
            fontSize={1}
            mode="ghost"
            onClick={onRestore}
            padding={2}
            text={t('action.restore')}
          />
        )}

        <Button
          disabled={busy}
          fontSize={1}
          mode="bleed"
          onClick={onClear}
          padding={2}
          text={t('selection.clear')}
        />
      </Flex>
    </Card>
  )
}
