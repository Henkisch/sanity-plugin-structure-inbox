import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

interface SelectionActionsProps {
  count: number
  /** True when the selection is in the Done tab, so the action is the inverse. */
  undo: boolean
  /** True when the source can complete items where they actually live. */
  resolves: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The bar that appears once rows are selected.
 *
 * One action, not a menu of near-synonyms: "Dismiss" and "Clear" sat side by
 * side and both read as ways to get rid of the selection. What an editor wants
 * to express is that a thing is done, so that is the only verb offered — and
 * "Cancel" means what it means everywhere else, which is "never mind".
 *
 * Whether done also changes anything outside this editor's inbox is the
 * source's business, so it is explained in the button's tooltip rather than
 * split into two buttons the editor has to choose between.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const {count, undo, resolves, busy, onConfirm, onCancel} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  return (
    <Card borderBottom padding={2} radius={0} tone="primary">
      <Flex align="center" gap={2}>
        <Box flex={1} paddingLeft={2}>
          <Text size={1} weight="medium">
            {t('selection.count', {count})}
          </Text>
        </Box>

        <Button
          disabled={busy}
          fontSize={1}
          onClick={onConfirm}
          padding={2}
          text={undo ? t('action.markNotDone') : t('action.markDone')}
          title={
            undo ? undefined : t(resolves ? 'action.markDone.resolves' : 'action.markDone.mine')
          }
          tone={undo ? 'default' : 'positive'}
        />

        <Button
          disabled={busy}
          fontSize={1}
          mode="bleed"
          onClick={onCancel}
          padding={2}
          text={t('selection.cancel')}
        />
      </Flex>
    </Card>
  )
}
