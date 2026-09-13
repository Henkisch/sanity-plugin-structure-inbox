import {UserIcon} from '@sanity/icons/User'
import {Avatar, Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {type CSSProperties, type MouseEvent, useCallback, useId, useState} from 'react'
import {useTranslation} from 'sanity'
import {useRouter} from 'sanity/router'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {RelativeTime} from './RelativeTime'
import {type InboxItem} from './types'

interface InboxRowProps {
  item: InboxItem
  /** Aside rows: tighter, without the Open button. */
  compact?: boolean
  /** Already ticked off. Only ever rendered while "Show done" is on. */
  done?: boolean
  selected: boolean
  /**
   * Fading out on its way to being marked done or snoozed, rather than
   * vanishing the instant the action bar is clicked — see `EXIT_ANIMATION_MS`.
   */
  leaving?: boolean
  onSelectedChange: (item: InboxItem, selected: boolean) => void
  /** The source's `assess`, if it has one — see `InboxSourceResult.assess`. */
  onAssess?: (item: InboxItem) => Promise<string>
  /** The source's `remove`, if it has one — see `InboxSourceResult.remove`. */
  onRemove?: (item: InboxItem) => Promise<void> | void
  /**
   * Opens this one item's edit dialog — only ever set for a row with no
   * `intent` to navigate to instead (a todo has no document), since a row
   * only ever does one of the two on click.
   */
  onEdit?: (item: InboxItem) => void
  /**
   * Reassigns this one item directly, without a bulk selection — clicking
   * the assignee avatar opens a small picker in place of it. Both this and
   * `assignableUsers` come from the row's own source's `assign`, so they're
   * either both present or both absent.
   */
  onReassign?: (item: InboxItem, userId: string) => void
  /** Who `onReassign` can hand this item to — see `InboxSourceResult.assign`. */
  assignableUsers?: {id: string; label: string}[]
  /**
   * Clears this item's assignee — offered in the same picker as `onReassign`,
   * only once there's actually an assignee to clear. Absent for a source
   * whose `assign` doesn't offer `unassign` at all.
   */
  onUnassign?: (item: InboxItem) => void
  /**
   * True when this row is selected and nothing else is. `assess`/`remove`
   * only render then — with several rows selected, one "Ask AI" per row was
   * exactly the busyness the rest of this pane was redesigned to avoid; the
   * single-row case is the one place asking about — or deleting — one
   * specific item still makes sense inline rather than through the bulk bar.
   */
  onlySelected?: boolean
  /**
   * A small tag identifying which source this row came from, e.g.
   * "Unpublished drafts · Everyone". Only meaningful in the merged list — a
   * per-source card already says this via its own header, so it's omitted
   * there. Text only, deliberately — a leading source icon next to this same
   * label said nothing the words didn't already say, just louder.
   */
  sourceLabel?: string
}

type Assessment = {status: 'idle'} | {status: 'loading'} | {status: 'done'; message: string}

// "AB" from "Ada Bergström", "A" from "Ada" — the same shorthand an avatar
// with no photo falls back to everywhere else in Studio.
function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

export function InboxRow(props: InboxRowProps) {
  const {
    item,
    compact = false,
    done = false,
    selected,
    leaving = false,
    onSelectedChange,
    onAssess,
    onRemove,
    onEdit,
    onReassign,
    assignableUsers,
    onUnassign,
    onlySelected = false,
    sourceLabel,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const {navigateIntent} = useRouter()
  const labelId = useId()
  const [assessment, setAssessment] = useState<Assessment>({status: 'idle'})

  // Checking a box marks the row, it does not act on it. Which action follows
  // is the editor's next decision, offered once something is selected — the
  // same order a mail client puts them in, and the reason a tick that silently
  // completed things felt wrong.
  const toggleSelected = useCallback(
    () => onSelectedChange(item, !selected),
    [item, onSelectedChange, selected],
  )

  // A row opens when it has somewhere to go — a document, matching how every
  // other list in Sanity itself behaves — and falls back to an edit dialog
  // when it doesn't (a todo) rather than doing nothing. Only when it has
  // neither does clicking it fall back to the old select-on-click behaviour;
  // the checkbox is always still there as a second, explicit way to select.
  const handleRowClick = useCallback(() => {
    if (item.intent) {
      navigateIntent(item.intent.type, item.intent.params)
      return
    }
    if (onEdit) {
      onEdit(item)
      return
    }
    toggleSelected()
  }, [item, onEdit, navigateIntent, toggleSelected])

  const stopPropagation = useCallback((event: MouseEvent) => {
    event.stopPropagation()
  }, [])

  const canReassign = Boolean(onReassign && assignableUsers && assignableUsers.length > 0)

  const handleAssess = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()
      if (!onAssess) return
      setAssessment({status: 'loading'})
      onAssess(item)
        .then((message) => setAssessment({status: 'done', message}))
        .catch(() => setAssessment({status: 'done', message: t('assess.error')}))
    },
    [onAssess, item, t],
  )

  // No local status to track on success: the row that just deleted itself is
  // about to unmount as the parent re-renders without it. A failure has
  // nowhere to show itself on a row that may no longer exist, so it goes to
  // the console instead, the same as a failed resolve or assign elsewhere in
  // this pane.
  const handleRemove = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation()
      Promise.resolve(onRemove?.(item)).catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not remove item', error)
      })
    },
    [onRemove, item],
  )

  // A done row drops its own tone: the point of showing it is that it is
  // finished, and a caution-coloured finished row still reads as urgent.
  const tone = done || item.tone === 'default' ? undefined : item.tone

  // A row on its way out (marked done or snoozed) fades rather than blinking
  // out the instant the action bar fires — the mutation it's fading towards
  // is what actually removes it moments later, see `EXIT_ANIMATION_MS`.
  const exitStyle: CSSProperties = {
    cursor: leaving ? 'default' : 'pointer',
    pointerEvents: leaving ? 'none' : undefined,
    transition: 'opacity 180ms ease',
    opacity: leaving ? 0 : 1,
  }

  const checkbox = (
    <Flex align="center" onClick={stopPropagation} paddingLeft={1} paddingRight={compact ? 1 : 2}>
      <Checkbox
        aria-labelledby={labelId}
        checked={selected}
        onChange={toggleSelected}
        title={t('selection.select')}
      />
    </Flex>
  )

  const assessRow = onAssess && (
    <Box>
      {assessment.status === 'idle' && (
        // `padding={0}`: a bleed button's own padding would indent "Ask AI"
        // past the subtitle line above it, reading as a stray control rather
        // than the row's own next line.
        <Button
          fontSize={0}
          mode="bleed"
          onClick={handleAssess}
          padding={0}
          text={t('assess.ask')}
        />
      )}
      {assessment.status === 'loading' && (
        <Text muted size={0}>
          {t('assess.loading')}
        </Text>
      )}
      {assessment.status === 'done' && (
        <Text muted size={0}>
          {assessment.message}
        </Text>
      )}
    </Box>
  )

  // A Jira-style avatar chip, not another line of text — the row already
  // says what it is; who it's assigned to reads faster as a face than as
  // "Assigned to you" repeated on every single row. Clicking it opens a
  // proper popup menu, when the row's source offers `assign` — the same
  // "reassign one item without a bulk selection" the direct-manipulation
  // pattern this pane was missing calls for. A native `<select>` did this
  // first, but rendered as an ugly, disconnected system picker on mobile
  // Safari; `MenuButton` is the same floating popover Studio's own assignee
  // pickers use.
  const assigneeAvatar = (() => {
    const assignee = item.assignee
    // Nothing to show, and no picker to open either — an item whose source
    // has no `assign` at all (a todo, a release) was never assignable to
    // begin with, so there's no "unassigned" to indicate.
    if (!assignee && !canReassign) return null

    const avatar = (
      <Box style={{position: 'relative'}}>
        <Avatar
          initials={assignee ? initials(assignee.label) : undefined}
          // A faint, empty circle for "assignable, nobody's picked it up yet"
          // — Jira's own convention for an unassigned issue, and why the draft
          // itself didn't already show a placeholder was the actual report:
          // the only sign it could be assigned at all was the bulk selection
          // bar's own "Assign to…" picker.
          size={compact ? 0 : 1}
          src={assignee?.imageUrl}
          style={canReassign ? {cursor: 'pointer', opacity: assignee ? 1 : 0.4} : undefined}
          title={assignee?.label ?? t('assignee.unassigned')}
        />
        {/* A person glyph on the faint circle above reads as "nobody yet" at
            a glance — an empty circle alone looked like a loading state or a
            rendering bug rather than a deliberate placeholder. Full opacity,
            unlike the circle beneath it: the circle is what's meant to fade,
            not the sign that it's still assignable. */}
        {!assignee && (
          <Flex
            align="center"
            justify="center"
            style={{inset: 0, pointerEvents: 'none', position: 'absolute'}}
          >
            <Text muted size={compact ? 0 : 1}>
              <UserIcon />
            </Text>
          </Flex>
        )}
      </Box>
    )

    return (
      <Box onClick={stopPropagation}>
        {canReassign ? (
          <MenuButton
            button={avatar}
            id={`${labelId}-assignee`}
            menu={
              <Menu>
                {assignableUsers?.map((user) => (
                  <MenuItem
                    key={user.id}
                    onClick={() => onReassign?.(item, user.id)}
                    pressed={user.label === assignee?.label}
                    text={user.label}
                  />
                ))}
                {/* Only once there's an assignee to clear, and only for a
                    source whose `assign` actually offers it. */}
                {assignee && onUnassign && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      onClick={() => onUnassign(item)}
                      text={t('assignee.unassign')}
                      tone="critical"
                    />
                  </>
                )}
              </Menu>
            }
            popover={{placement: 'bottom-end', portal: true}}
          />
        ) : (
          avatar
        )}
      </Box>
    )
  })()

  const removeRow = onRemove && (
    <Box>
      <Button
        fontSize={0}
        mode="bleed"
        onClick={handleRemove}
        padding={0}
        text={t('action.delete')}
        tone="critical"
      />
    </Box>
  )

  const label = (
    <Stack flex={1} gap={2}>
      <Text
        id={labelId}
        muted={done}
        size={1}
        textOverflow="ellipsis"
        weight={compact ? undefined : 'medium'}
      >
        {item.title}
      </Text>
      {(sourceLabel || item.subtitle || item.timestamp) && (
        <Text muted size={0} textOverflow="ellipsis">
          {sourceLabel}
          {sourceLabel && (item.subtitle || item.timestamp) ? ' · ' : ''}
          {item.subtitle}
          {item.subtitle && item.timestamp ? ' · ' : ''}
          {item.timestamp && <RelativeTime timestamp={item.timestamp} />}
        </Text>
      )}
      {/* Only for a lone selected row: see `onlySelected` above. */}
      {!compact && onlySelected && (assessRow || removeRow) && (
        <Flex gap={3}>
          {assessRow}
          {removeRow}
        </Flex>
      )}
    </Stack>
  )

  if (compact) {
    return (
      <Card
        aria-hidden={leaving}
        onClick={leaving ? undefined : handleRowClick}
        padding={2}
        radius={2}
        style={exitStyle}
        tone={selected ? 'primary' : tone}
      >
        <Flex align="center" gap={1}>
          {checkbox}
          <Box flex={1}>{label}</Box>
          {assigneeAvatar}
        </Flex>
      </Card>
    )
  }

  return (
    <Card
      aria-hidden={leaving}
      onClick={leaving ? undefined : handleRowClick}
      padding={2}
      radius={2}
      style={exitStyle}
      tone={selected ? 'primary' : tone}
    >
      {/* `flex-start`, not `center`: the assess row can make this taller than
          a single line, and a vertically-centered checkbox then floats away
          from the title it labels. */}
      <Flex align="flex-start" gap={2}>
        {checkbox}

        <Box flex={1}>{label}</Box>

        {assigneeAvatar}
      </Flex>
    </Card>
  )
}
