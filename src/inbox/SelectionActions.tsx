import {Box, Button, Card, Flex, Select, Text} from '@sanity/ui'
import {type ChangeEvent} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type SnoozePreset} from '../store/snoozePresets'
import {type InboxView} from './types'

interface SelectionActionsProps {
  count: number
  view: InboxView
  /** True when the source can complete items where they actually live. */
  resolves: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Offers the "Snooze" picker. Only meaningful in the open view — snoozing a
   * row that is already done or already asleep says nothing.
   */
  onSnooze?: (preset: SnoozePreset) => void
}

const SNOOZE_PRESETS: SnoozePreset[] = ['laterToday', 'tomorrow', 'nextWeek']

const SNOOZE_PRESET_LABEL_KEYS: Record<SnoozePreset, string> = {
  laterToday: 'action.snooze.laterToday',
  tomorrow: 'action.snooze.tomorrow',
  nextWeek: 'action.snooze.nextWeek',
}

function isSnoozePreset(value: string): value is SnoozePreset {
  return value in SNOOZE_PRESET_LABEL_KEYS
}

/**
 * The bar that appears once rows are selected.
 *
 * The primary action is always one verb for the tab it appears in — "Mark as
 * done" in Open, "Mark as not done" in Done, "Wake now" in Snoozed — never a
 * menu of near-synonyms standing in for the same thing. "Snooze" next to it
 * in the Open view is not a synonym: it defers rather than completes, which
 * is why it earns a control of its own instead of collapsing into the first.
 *
 * The snooze picker is a plain `<select>` rather than a popover menu: this
 * kit ships no menu/popover primitive, and a native select needs none — it
 * gets keyboard and screen-reader behaviour for free.
 *
 * Whether "done" also changes anything outside this editor's inbox is the
 * source's business, so it is explained in the button's tooltip rather than
 * split into two buttons the editor has to choose between.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const {count, view, resolves, busy, onConfirm, onCancel, onSnooze} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const confirmLabel =
    view === 'done'
      ? t('action.markNotDone')
      : view === 'snoozed'
        ? t('action.wakeNow')
        : t('action.markDone')

  // Pinned to the placeholder rather than tracking the choice: the picker's
  // job is to fire an action, not to remember one — leaving a preset showing
  // as "selected" after acting on it would misstate what just happened.
  const handleSnoozeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    if (isSnoozePreset(value)) onSnooze?.(value)
  }

  return (
    <Card borderBottom padding={2} radius={0} tone="primary">
      <Flex align="center" gap={2}>
        <Box flex={1} paddingLeft={2}>
          <Text size={1} weight="medium">
            {t('selection.count', {count})}
          </Text>
        </Box>

        {onSnooze && (
          <Box>
            <Select fontSize={1} onChange={handleSnoozeChange} value="">
              <option disabled value="">
                {t('action.snooze')}
              </option>
              {SNOOZE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {t(SNOOZE_PRESET_LABEL_KEYS[preset])}
                </option>
              ))}
            </Select>
          </Box>
        )}

        <Button
          disabled={busy}
          fontSize={1}
          onClick={onConfirm}
          padding={2}
          text={confirmLabel}
          title={
            view === 'open'
              ? t(resolves ? 'action.markDone.resolves' : 'action.markDone.mine')
              : undefined
          }
          tone={view === 'open' ? 'positive' : 'default'}
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
