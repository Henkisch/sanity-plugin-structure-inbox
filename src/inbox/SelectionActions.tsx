import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {ChevronDownIcon} from '@sanity/icons/ChevronDown'
import {ClockIcon} from '@sanity/icons/Clock'
import {TrashIcon} from '@sanity/icons/Trash'
import {Box, Button, Flex, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
import {type ComponentType} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type InboxView} from './types'

/**
 * The AI-suggested-snooze read's own state — `MergedList.tsx` owns the
 * fetch (an explicit click, never automatic — see Plan 043), this file owns
 * how each state renders. Mirrors the `{status: ...}` shape every other
 * per-item AI read in this pane already uses (see `AskState` in
 * `AskInbox.tsx` for the closest analog).
 */
export type SnoozeSuggestionState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; until: string; reason?: string}
  | {status: 'none'}
  | {status: 'error'}

/**
 * `suggestAssignee`'s own state — unlike `SnoozeSuggestionState`, the
 * fetch behind this one fires automatically on selection change rather
 * than from a click (see `assigneeSuggestion`'s own doc comment below and
 * `MergedList.tsx`'s effect): it's a fast, non-billed fact lookup, not an
 * AI read that needs consent-gating. Only the *rendering* shape mirrors
 * the snooze suggestion, not the triggering.
 */
export type AssigneeSuggestionState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; userId: string; reason: 'lastEditor' | 'mentioned'}
  | {status: 'none'}
  | {status: 'error'}

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
   * see `InboxSourceResult.suggestSnooze`'s own doc comment. Idle until
   * `onSuggestSnooze` is actually clicked (see Plan 043 — this used to fetch
   * automatically on selection, spending a real AI credit with no click and
   * no consent; now it only ever fires from an explicit click, the same
   * "ask, then show" shape `assess`/`fix` already use elsewhere in this
   * pane). Never pre-applied even once resolved: the editor still has to
   * press the resulting date button, the same as picking a preset would be.
   */
  snoozeSuggestion?: SnoozeSuggestionState
  /** Fires the AI read itself — the only place `suggestSnooze` is ever called. Absent when the current selection has no such capability. */
  onSuggestSnooze?: () => void
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
  assigneeSuggestion?: AssigneeSuggestionState
  /**
   * Who `onTransfer` can hand the selection to — absent or empty hides the
   * picker. Distinct from `assignableUsers`/`onAssign`: a source offers one
   * or the other, never both (see `InboxSourceResult.transfer`'s own doc
   * comment on why they're different verbs), so only one of the two
   * pickers ever actually renders for a given selection.
   */
  transferableUsers?: {id: string; label: string}[]
  /** Offers the "Hand off to…" picker. Only meaningful in the open view, same reasoning as `onAssign`. */
  onTransfer?: (userId: string) => void
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
 * The "Assign to…"/"Hand off to…" picker — a `MenuButton`, not a native
 * `<select>`. An earlier version of this used `<select>`, the same reason
 * `InboxRow.tsx`'s own per-row picker did before it — a native picker
 * rendered as an ugly, disconnected system dropdown on mobile Safari, and
 * (unlike a floating popover) took its full intrinsic width in the layout
 * regardless of how little room the row actually had — the likely reason
 * the Ask input next to it could shrink to invisible at some in-between
 * widths, since the header's own `ask` grid column is the only flexible
 * one sharing space with this picker's fixed-width `<select>`.
 * `MenuButton` is the same floating popover both
 * `InboxRow.tsx`'s per-row picker and Studio's own assignee pickers use —
 * one consistent pattern everywhere a name gets picked in this plugin,
 * not two.
 */
function ReassignMenu(props: {
  disabled: boolean
  onPick: (userId: string) => void
  users: {id: string; label: string}[]
  verb: string
}) {
  const {disabled, onPick, users, verb} = props
  return (
    <MenuButton
      button={<Button disabled={disabled} fontSize={1} iconRight={ChevronDownIcon} mode="ghost" text={verb} />}
      id={`reassign-menu-${verb}`}
      menu={
        <Menu>
          {users.map((user) => (
            <MenuItem key={user.id} onClick={() => onPick(user.id)} text={user.label} />
          ))}
        </Menu>
      }
      popover={{placement: 'bottom-end', portal: true}}
    />
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
    onSuggestSnooze,
    onSnoozeUntil,
    assignableUsers,
    onAssign,
    assigneeSuggestion,
    transferableUsers,
    onTransfer,
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

  const suggestedUser =
    assigneeSuggestion?.status === 'done'
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

      {/* Idle: a plain trigger, not an already-resolved answer — clicking it
          is the only thing that ever spends the AI credit `suggestSnooze`
          bills (see Plan 043). Only rendered at all when the current
          selection actually has the capability (`onSuggestSnooze` is only
          ever passed down from `MergedList.tsx` when it does). */}
      {onSuggestSnooze && snoozeSuggestion?.status === 'idle' && (
        <Button
          disabled={busy}
          fontSize={0}
          mode="bleed"
          onClick={onSuggestSnooze}
          padding={1}
          text={t('snooze.suggest.ask')}
        />
      )}

      {snoozeSuggestion?.status === 'loading' && (
        <Button disabled fontSize={0} mode="bleed" padding={1} text={t('snooze.suggest.loading')} />
      )}

      {snoozeSuggestion?.status === 'done' && onSnoozeUntil && (
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

      {/* The AI genuinely had no date to suggest — a muted note, not
          silence, so a click that resolved to "nothing to suggest" doesn't
          read as if the click never registered. */}
      {snoozeSuggestion?.status === 'none' && (
        <Text muted size={0}>
          {t('snooze.suggest.none')}
        </Text>
      )}

      {/* Same treatment `assess.error`/`fix.error` already use elsewhere in
          this pane — a plain error line, no retry button (see Plan 034 for
          why a fake retry button is worse than none). */}
      {snoozeSuggestion?.status === 'error' && (
        <Text muted size={0}>
          {t('assess.error')}
        </Text>
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

      {assigneeSuggestion?.status === 'loading' && (
        <Button disabled fontSize={0} mode="bleed" padding={1} text={t('assignee.suggest.loading')} />
      )}

      {assigneeSuggestion?.status === 'done' && onAssign && suggestedUser && (
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

      {/* No branch for `status === 'none'` — unlike the snooze suggestion,
          where "the AI genuinely had no date to suggest" is worth saying, an
          assignee suggestion resolving to "nobody in particular" is a
          common, unremarkable outcome (most rows have no
          last-editor/mention signal); rendering nothing here matches
          today's effective behavior. */}

      {assigneeSuggestion?.status === 'error' && (
        <Text muted size={0}>
          {t('assess.error')}
        </Text>
      )}

      {onAssign && assignableUsers && assignableUsers.length > 0 && (
        <ReassignMenu
          disabled={busy}
          onPick={onAssign}
          users={assignableUsers}
          verb={t('action.assign')}
        />
      )}

      {onTransfer && transferableUsers && transferableUsers.length > 0 && (
        <ReassignMenu
          disabled={busy}
          onPick={onTransfer}
          users={transferableUsers}
          verb={t('action.transfer')}
        />
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
