import {Box, Button, Card, Flex, Select, Stack, Text} from '@sanity/ui'
import {type ChangeEvent} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type SnoozePreset} from '../store/snoozePresets'
import {type InboxView} from './types'

interface SelectionActionsProps {
  count: number
  view: InboxView
  /**
   * How many of the `count` selected rows can actually be completed where
   * they live (a real `resolve`) — `0` means every row will only be
   * acknowledged, `count` means every row will really resolve, anything
   * between is a mixed batch that does both at once.
   */
  resolvableCount: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Offers the "Snooze" picker. Only meaningful in the open view — snoozing a
   * row that is already done or already asleep says nothing.
   */
  onSnooze?: (preset: SnoozePreset) => void
  /** Who `onAssign` can hand the selection to — absent or empty hides the picker. */
  assignableUsers?: {id: string; label: string}[]
  /** Offers the "Assign" picker. Only meaningful in the open view, same reasoning as `onSnooze`. */
  onAssign?: (userId: string) => void
  /** Offers "Save to todos". Only meaningful in the open view, same reasoning as `onSnooze`. */
  onSaveToTodos?: () => void
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
 * done"/"Acknowledge" in Open, "Mark as not done" in Cleared, "Wake now" in
 * Snoozed — never a menu of near-synonyms standing in for the same thing.
 * "Snooze" next to it in the Open view is not a synonym: it defers rather
 * than completes, which is why it earns a control of its own instead of
 * collapsing into the first.
 *
 * In the Open view, the label itself depends on `resolvableCount`: "Mark as
 * done" only when every selected row can really resolve (or a mixed batch —
 * it still resolves what it can), "Acknowledge" when none of them can. This
 * is the one place this plugin distinguishes those two verbs at all — see
 * `splitItems.ts`'s own doc comment for why they're different actions, not
 * two names for the same one.
 *
 * The snooze picker is a plain `<select>` rather than a popover menu: this
 * kit ships no menu/popover primitive, and a native select needs none — it
 * gets keyboard and screen-reader behaviour for free.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const {
    count,
    view,
    resolvableCount,
    busy,
    onConfirm,
    onCancel,
    onSnooze,
    assignableUsers,
    onAssign,
    onSaveToTodos,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  const confirmLabel =
    view === 'cleared'
      ? t('action.markNotDone')
      : view === 'snoozed'
        ? t('action.wakeNow')
        : resolvableCount === 0
          ? t('action.acknowledge')
          : t('action.markDone')

  // Pinned to the placeholder rather than tracking the choice: the picker's
  // job is to fire an action, not to remember one — leaving a preset showing
  // as "selected" after acting on it would misstate what just happened.
  const handleSnoozeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    if (isSnoozePreset(value)) onSnooze?.(value)
  }

  // Same "pinned to the placeholder" reasoning as the snooze picker above.
  const handleAssignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    if (value) onAssign?.(value)
  }

  return (
    <Card borderBottom padding={2} radius={0} tone="primary">
      {/* Two flat rows, not one nested flex: nesting a `flex={1}` group inside
          a wrapping outer `Flex` let the two levels of `wrap` interleave —
          on a narrow phone, Snooze, the count, and Cancel each landed on
          their own line in source order rather than a predictable stack.
          Pairing the count with Cancel up top (the one thing every mail
          client's mobile selection bar agrees on) and letting the action
          controls wrap as one plain row below sidesteps that entirely. */}
      <Stack gap={2}>
        <Flex align="center" justify="space-between">
          <Box aria-live="polite" paddingLeft={2}>
            <Text size={1} weight="medium">
              {t('selection.count', {count})}
            </Text>
          </Box>

          <Button
            disabled={busy}
            fontSize={1}
            mode="bleed"
            onClick={onCancel}
            padding={2}
            text={t('selection.cancel')}
          />
        </Flex>

        <Flex align="center" gap={2} paddingLeft={2} wrap="wrap">
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

          {onAssign && assignableUsers && assignableUsers.length > 0 && (
            <Box>
              <Select fontSize={1} onChange={handleAssignChange} value="">
                <option disabled value="">
                  {t('action.assign')}
                </option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.label}
                  </option>
                ))}
              </Select>
            </Box>
          )}

          {onSaveToTodos && (
            <Button
              disabled={busy}
              fontSize={1}
              mode="bleed"
              onClick={onSaveToTodos}
              padding={2}
              text={t('action.saveToTodos')}
            />
          )}

          <Button
            disabled={busy}
            fontSize={1}
            onClick={onConfirm}
            padding={2}
            text={confirmLabel}
            title={
              view === 'open'
                ? t(
                    resolvableCount === 0
                      ? 'action.acknowledge.hint'
                      : resolvableCount === count
                        ? 'action.markDone.resolves'
                        : 'action.markDone.mixed',
                  )
                : undefined
            }
            tone={view === 'open' ? 'positive' : 'default'}
          />
        </Flex>
      </Stack>
    </Card>
  )
}
