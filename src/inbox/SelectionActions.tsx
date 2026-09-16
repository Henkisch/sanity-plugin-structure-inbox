import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {ClockIcon} from '@sanity/icons/Clock'
import {TrashIcon} from '@sanity/icons/Trash'
import {Box, Button, Flex, Select, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import {type ChangeEvent, type ComponentType} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
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
  /**
   * Whether the confirm button ("Mark as done"/"Clear"/"Mark as not
   * done"/"Wake now") does anything at all for this selection. False only in
   * the Open view, and only when every selected row is from a source with
   * neither `resolve` nor `acknowledgable` (`todos`) — there is nothing
   * real for it to do there (see `todos.ts`'s own doc comment: a todo is
   * either still on the list or `remove`d, nothing in between), so the
   * button is hidden rather than left sitting there as a dead click. Cleared
   * and Snoozed always have something real to confirm, since every row
   * there got there through a resolve, a manual clear, or a snooze — all of
   * which this button can undo.
   */
  showConfirm: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Offers "Snooze" — one click, one sensible default (see
   * `SNOOZE_DEFAULT_PRESET` in `MergedList.tsx`), not a picker. Only
   * meaningful in the open view — snoozing a row that is already done or
   * already asleep says nothing.
   */
  onSnooze?: () => void
  /**
   * An AI-read alternative to the default, for exactly one selected row —
   * see `InboxSourceResult.suggestSnooze`'s own doc comment. Rendered as its
   * own small button next to the plain Snooze icon, never pre-applied: the
   * editor still has to press it, the same as picking a preset would be.
   */
  snoozeSuggestion?: {until: string; reason?: string}
  onSnoozeUntil?: (until: string) => void
  /** Who `onAssign` can hand the selection to — absent or empty hides the picker. */
  assignableUsers?: {id: string; label: string}[]
  /** Offers the "Assign" picker. Only meaningful in the open view, same reasoning as `onSnooze`. */
  onAssign?: (userId: string) => void
  /**
   * A fact-based alternative to picking a name — see
   * `InboxSourceResult.suggestAssignee`'s own doc comment. Rendered as its
   * own small button next to the picker, never pre-selected in it: the
   * editor still has to click, the same as choosing from the `<select>`
   * would be.
   */
  assigneeSuggestion?: {userId: string; reason: 'lastEditor' | 'mentioned'}
  /**
   * Offers "Delete" — for real removal (`todos`, say), not a soft dismiss.
   * Used to live as a plain text link under a lone selected row
   * (`InboxRow.tsx`'s own `removeRow`), which read as a stray control rather
   * than a deliberate one; this is the standard place every other selection
   * action already lives. Absent when nothing selected can actually be
   * removed.
   */
  onDelete?: () => void
}

/**
 * A single icon button with its label as a hover tooltip, not visible text —
 * Snooze/Delete are well-understood by their glyph alone (the same bet
 * Gmail's own selection toolbar makes), and dropping the text is what lets
 * the whole bar stay content-sized instead of needing room to spell each one
 * out. Cancel is the one exception — see the plain text `Button` below it
 * gets instead of this.
 */
function IconAction(props: {
  disabled: boolean
  icon: ComponentType
  label: string
  onClick: () => void
  tone?: 'default' | 'critical'
}) {
  const {disabled, icon: Icon, label, onClick, tone} = props
  return (
    <Tooltip
      content={
        <Box padding={2}>
          <Text size={1}>{label}</Text>
        </Box>
      }
      placement="bottom"
    >
      <Button
        aria-label={label}
        disabled={disabled}
        icon={Icon}
        mode="bleed"
        onClick={onClick}
        padding={2}
        tone={tone}
      />
    </Tooltip>
  )
}

/**
 * The controls that replace the header's own filter bar once rows are
 * selected — same slot, `MergedList.tsx`'s header `Flex`, opposite the
 * select-all checkbox. Renders no card or border of its own: it lives inside
 * a header that already has both, the same way Gmail's own selection
 * toolbar takes over its list's existing top bar rather than opening a
 * second one beneath it.
 *
 * Content-sized and left-grouped, not stretched to fill the space the filter
 * bar used to take — an earlier version used `justify="space-between"` to
 * spread Cancel and the actions across the whole row, which looked
 * deliberate on a narrow phone (the reason it was built that way) but left a
 * wide, dead gap on any normal-or-wider screen. Gmail's own selection
 * toolbar is the model here: a tight cluster of icon buttons sized to their
 * own content, not the container's.
 *
 * The primary action is always one verb for the tab it appears in — "Mark as
 * done"/"Acknowledge" in Open, "Mark as not done" in Cleared, "Wake now" in
 * Snoozed — never a menu of near-synonyms standing in for the same thing.
 * Kept as icon *and* text, unlike Cancel/Snooze/Delete: its label is the one
 * piece of real information in this bar (which of several different verbs is
 * about to happen), so it is the one control here that still needs to say
 * that in words, not just a glyph.
 *
 * In the Open view, the label itself depends on `resolvableCount`: "Mark as
 * done" only when every selected row can really resolve (or a mixed batch —
 * it still resolves what it can), "Acknowledge" when none of them can. This
 * is the one place this plugin distinguishes those two verbs at all — see
 * `splitItems.ts`'s own doc comment for why they're different actions, not
 * two names for the same one.
 *
 * "Snooze" is a plain button, not a picker: an earlier version offered three
 * presets (later today/tomorrow/next week) behind a native `<select>`, which
 * read as its own small puzzle — a placeholder option rendered checkmarked
 * like a real choice, three near-identical durations to weigh for a single
 * "not now" click. One click, one default, is what "not now" actually needs.
 */
export function SelectionActions(props: SelectionActionsProps) {
  const {
    count,
    view,
    resolvableCount,
    showConfirm,
    busy,
    onConfirm,
    onCancel,
    onSnooze,
    snoozeSuggestion,
    onSnoozeUntil,
    assignableUsers,
    onAssign,
    assigneeSuggestion,
    onDelete,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  // A manual Clear changes nothing in Sanity (see `action.clear.hint`) — the
  // editor's own call, not a real completion. Only a real resolve ("Mark as
  // done") earns the same filled, primary-toned button; Clear sits alongside
  // Cancel/Snooze/Delete as a plain default-toned one instead, so the one
  // button that visually shouts "primary action" is always one that
  // actually does something for real.
  const isRealResolve = view === 'open' && resolvableCount > 0

  const confirmLabel =
    view === 'cleared'
      ? t('action.markNotDone')
      : view === 'snoozed'
        ? t('action.wakeNow')
        : resolvableCount === 0
          ? t('action.clear')
          : t('action.markDone')

  // Pinned to the placeholder rather than tracking the choice: the picker's
  // job is to fire an action, not to remember one — leaving a choice showing
  // as "selected" after acting on it would misstate what just happened.
  const handleAssignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    if (value) onAssign?.(value)
  }

  const suggestedUser = assigneeSuggestion
    ? assignableUsers?.find((user) => user.id === assigneeSuggestion.userId)
    : undefined

  return (
    // No count text here — it renders in `MergedList.tsx`'s own header,
    // next to the select-all menu that controls it, so this bar is only the
    // actions themselves, free to sit flush right against the opposite end
    // of the header from that count.
    <Flex align="center" gap={1} wrap="wrap">
      {/* Text, not an icon — an "X" here reads as "close/discard" (this
          selection bar isn't a dialog to dismiss), where the same word
          spelled out is unambiguous. Every other control in this cluster
          only fires once you've chosen what happens to the selection; this
          is the one that means "never mind", so it earns being named rather
          than guessed at. */}
      <Button disabled={busy} fontSize={1} mode="bleed" onClick={onCancel} padding={2} text={t('selection.cancel')} />

      {onSnooze && (
        <IconAction disabled={busy} icon={ClockIcon} label={t('action.snooze')} onClick={onSnooze} />
      )}

      {snoozeSuggestion && onSnoozeUntil && (
        <Tooltip
          content={
            snoozeSuggestion.reason ? (
              <Box padding={2} style={{maxWidth: 200}}>
                <Text size={1}>{snoozeSuggestion.reason}</Text>
              </Box>
            ) : undefined
          }
          placement="bottom"
        >
          <Button
            disabled={busy}
            fontSize={0}
            mode="bleed"
            onClick={() => onSnoozeUntil(snoozeSuggestion.until)}
            padding={1}
            text={t('action.snooze.suggested', {
              date: new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(
                new Date(snoozeSuggestion.until),
              ),
            })}
          />
        </Tooltip>
      )}

      {onDelete && (
        <IconAction
          disabled={busy}
          icon={TrashIcon}
          label={t('action.delete')}
          onClick={onDelete}
          tone="critical"
        />
      )}

      {assigneeSuggestion && onAssign && suggestedUser && (
        <Tooltip
          content={
            <Box padding={2}>
              <Text size={1}>{t(`action.assign.reason.${assigneeSuggestion.reason}`)}</Text>
            </Box>
          }
          placement="bottom"
        >
          <Button
            disabled={busy}
            fontSize={0}
            mode="bleed"
            onClick={() => onAssign(suggestedUser.id)}
            padding={1}
            text={t('action.assign.suggested', {name: suggestedUser.label})}
          />
        </Tooltip>
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

      {showConfirm && (
        // `marginLeft`, on top of the cluster's own `gap`: the confirm
        // button is a bigger, bordered block next to plain icon buttons —
        // the same 4px gap that reads fine between two icon buttons read
        // as noticeably tighter here, since perceived spacing tracks the
        // visual weight on either side of it, not just the raw pixel gap.
        // Confirmed live: without this, Delete's own icon looked like it
        // was crowding straight into Confirm's edge.
        <Box style={{marginLeft: 8}}>
          <Button
            disabled={busy}
            fontSize={1}
            icon={CheckmarkIcon}
            onClick={onConfirm}
            padding={2}
            text={confirmLabel}
            title={
              view === 'open'
                ? t(
                    resolvableCount === 0
                      ? 'action.clear.hint'
                      : resolvableCount === count
                        ? 'action.markDone.resolves'
                        : 'action.markDone.mixed',
                  )
                : undefined
            }
            tone={isRealResolve ? 'primary' : 'default'}
          />
        </Box>
      )}
    </Flex>
  )
}
