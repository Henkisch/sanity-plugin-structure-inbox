import {EllipsisVerticalIcon} from '@sanity/icons/EllipsisVertical'
import {SparklesIcon} from '@sanity/icons/Sparkles'
import {UserIcon} from '@sanity/icons/User'
import {Avatar, Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {type CSSProperties, type MouseEvent, useCallback, useId, useState} from 'react'
import {useCurrentUser, useTranslation} from 'sanity'
import {useRouter} from 'sanity/router'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {RelativeTime} from './RelativeTime'
import {type FixProposal, type InboxItem} from './types'

interface InboxRowProps {
  item: InboxItem
  /** Aside rows: tighter, without the Open button. */
  compact?: boolean
  /** Already ticked off. Only ever rendered while "Show done" is on. */
  done?: boolean
  /**
   * Omit both this and `onSelectedChange` for a source with no bulk-selection
   * mechanism of its own to hook into (today, every `aside` source: ambient
   * context to glance at and open, not a worklist to multi-select and clear).
   * The row still opens via `intent`/`onEdit` either way — only the checkbox
   * and the click-to-select fallback disappear.
   */
  selected?: boolean
  /**
   * Fading out on its way to being marked done or snoozed, rather than
   * vanishing the instant the action bar is clicked — see `EXIT_ANIMATION_MS`.
   */
  leaving?: boolean
  onSelectedChange?: (item: InboxItem, selected: boolean) => void
  /**
   * The source's `assess`, if it has one — see `InboxSourceResult.assess`.
   * Offered as an "Ask AI" entry in this row's own three-dot menu (never for
   * a `compact` row, which has no menu at all — see `menuActions`), not a
   * permanently-visible link: a small text button sitting under every row's
   * title read as noise living there uninvited, especially once several rows
   * on screen each grew one. The answer itself still renders inline, below
   * the title, same as before — just only once actually asked for.
   */
  onAssess?: (item: InboxItem) => Promise<string>
  /**
   * The source's `proposeFix`, if it has one and `item.fixable` says this
   * particular row is one of the eligible ones — see
   * `InboxSourceResult.proposeFix`'s own doc comment. Adds "Fix with AI" to
   * this same three-dot menu, alongside "Ask AI" — clicking it fetches a
   * proposal and renders it inline (same slot the assess answer uses),
   * with its own Apply/Dismiss rather than writing anything immediately.
   */
  onProposeFix?: (item: InboxItem) => Promise<FixProposal | null>
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
   * The row's own source has a real assignee concept but doesn't want it
   * edited from here — see `InboxSourceResult.assigneeReadOnly`'s own doc
   * comment. Shows the avatar (or the "Unassigned" placeholder) same as
   * always, just non-interactive: a disabled cursor and a tooltip saying
   * why, instead of either a dead click or the avatar disappearing
   * depending on whether anyone happens to be assigned right now.
   */
  assigneeReadOnly?: boolean
  /**
   * A small tag identifying which source this row came from, e.g.
   * "Unpublished drafts · Everyone". Only meaningful in the merged list — a
   * per-source card already says this via its own header, so it's omitted
   * there. Text only, deliberately — a leading source icon next to this same
   * label said nothing the words didn't already say, just louder.
   */
  sourceLabel?: string
  /**
   * Per-row actions reachable without selecting first — a three-dot menu
   * to the right of the assignee avatar, offering the same actions the
   * bulk selection bar does (mark done/clear, snooze, wake, restore), for
   * just this one row. Omit for a row with no such mechanism at all (every
   * `aside` row today — ambient context, not a worklist). `onAssess`, when
   * present, adds "Ask AI" to this same menu rather than needing its own —
   * see its own doc comment.
   */
  menuActions?: {key: string; label: string; onClick: () => void; tone?: 'critical' | 'caution'}[]
}

type Assessment = {status: 'idle'} | {status: 'loading'} | {status: 'done'; message: string}

// `'none'` (proposeFix resolved, nothing good to suggest) is a distinct
// state from `'error'` (the call itself failed) — both render as a single
// muted line, but they're not the same thing, and collapsing them would
// have made a genuine failure read as "AI looked and found nothing," which
// isn't what happened.
type FixState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'none'}
  | {status: 'proposed'; proposal: FixProposal}
  | {status: 'applying'; proposal: FixProposal}
  | {status: 'applied'}
  | {status: 'error'}

// "AB" from "Ada Bergström", "A" from "Ada" — the same shorthand an avatar
// with no photo falls back to everywhere else in Studio. Exported for
// `Inbox.tsx`'s assignee filter chips, the one other place that draws an
// avatar from just a label.
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

/**
 * The empty circle with a person glyph — Jira's own convention for
 * "assignable, nobody's picked it up yet" — factored out so `Inbox.tsx`'s
 * "Unassigned" filter chip can draw the exact same placeholder instead of
 * restating it as text next to everyone else's photo. Full opacity here,
 * unlike a row's own inline placeholder (`assigneeAvatar` below): a filter
 * chip sits among other equally-solid avatars it needs to read as one of,
 * not among assigned items it's meant to visually recede next to.
 *
 * Purely visual — no click handling of its own. `Inbox.tsx` wraps it (and
 * every other avatar in its stack) in a plain `<button>` instead of styling
 * this component itself as one: overriding `Avatar`'s own internal style
 * this way, for both the ring and the `as="button"` tag swap, is what broke
 * its icon's positioning the first time this was tried.
 *
 * A plain filled circle, not an `Avatar`: `Avatar` with neither `initials`
 * nor `src` still picks a background from its own themed palette
 * (deterministic, not random — but not this component's to control), and in
 * this theme that happened to land on the exact same colour `Text muted`
 * renders in, making the icon on top of it disappear against its own
 * background. A `Card tone="transparent"` sidestepped that but rendered
 * closer to see-through than solid — a fixed, opaque hex, not a theme tone,
 * is what actually guarantees both "solid" and "not the same as the icon."
 */
const UNASSIGNED_AVATAR_DIAMETER: Record<0 | 1 | 2, number> = {0: 19, 1: 25, 2: 35}

export function UnassignedAvatar({size = 1}: {size?: 0 | 1 | 2}) {
  const diameter = UNASSIGNED_AVATAR_DIAMETER[size]
  return (
    <Box style={{height: diameter, position: 'relative', width: diameter}}>
      {/* `borderRadius: '50%'` via raw style, not the `radius` prop: `radius`
          is Sanity's own small integer scale (fixed px steps), not an
          arbitrary pixel value — passing the diameter through it left visible
          straight edges instead of a full circle. */}
      <Box style={{background: '#6b7280', borderRadius: '50%', height: '100%', width: '100%'}} />
      <Flex
        align="center"
        justify="center"
        style={{inset: 0, pointerEvents: 'none', position: 'absolute'}}
      >
        <Text muted size={size}>
          <UserIcon />
        </Text>
      </Flex>
    </Box>
  )
}

export function InboxRow(props: InboxRowProps) {
  const {
    item,
    compact = false,
    done = false,
    selected = false,
    leaving = false,
    onSelectedChange,
    onAssess,
    onProposeFix,
    onEdit,
    onReassign,
    assignableUsers,
    onUnassign,
    assigneeReadOnly = false,
    sourceLabel,
    menuActions,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const currentUser = useCurrentUser()
  const {navigateIntent} = useRouter()
  const labelId = useId()
  const [assessment, setAssessment] = useState<Assessment>({status: 'idle'})
  const [fix, setFix] = useState<FixState>({status: 'idle'})

  // Checking a box marks the row, it does not act on it. Which action follows
  // is the editor's next decision, offered once something is selected — the
  // same order a mail client puts them in, and the reason a tick that silently
  // completed things felt wrong.
  const toggleSelected = useCallback(
    () => onSelectedChange?.(item, !selected),
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

  // No event to stop propagating here, unlike the row's other inline handlers
  // — this only ever fires from a `MenuItem` inside a portal-rendered
  // popover, never from anything nested inside the row's own clickable card.
  const handleAssess = useCallback(() => {
    if (!onAssess) return
    setAssessment({status: 'loading'})
    onAssess(item)
      .then((message) => setAssessment({status: 'done', message}))
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] assess failed', error)
        setAssessment({status: 'done', message: t('assess.error')})
      })
  }, [onAssess, item, t])

  const handleProposeFix = useCallback(() => {
    if (!onProposeFix) return
    setFix({status: 'loading'})
    onProposeFix(item)
      .then((proposal) => setFix(proposal ? {status: 'proposed', proposal} : {status: 'none'}))
      .catch(() => setFix({status: 'error'}))
  }, [onProposeFix, item])

  const handleApplyFix = useCallback(() => {
    setFix((current) => {
      if (current.status !== 'proposed') return current
      const {proposal} = current
      proposal
        .apply()
        .then(() => setFix({status: 'applied'}))
        .catch(() => setFix({status: 'error'}))
      return {status: 'applying', proposal}
    })
  }, [])

  const handleDismissFix = useCallback(() => setFix({status: 'idle'}), [])

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

  const checkbox = onSelectedChange && (
    <Flex align="center" onClick={stopPropagation} paddingLeft={1} paddingRight={compact ? 1 : 2}>
      <Checkbox
        aria-labelledby={labelId}
        checked={selected}
        onChange={toggleSelected}
        title={t('selection.select')}
      />
    </Flex>
  )

  // No "idle" state to render here — asking is now the "Ask AI" entry in
  // this row's own three-dot menu (see `onAssess`'s own doc comment), not a
  // permanently-visible link. This only ever appears once that's actually
  // been clicked, and stays until the row itself unmounts.
  const assessRow = onAssess && assessment.status !== 'idle' && (
    <Flex align="center" gap={2}>
      {/* Marks this line as AI-sourced at a glance — without it, a plain
          muted line here read as just another piece of row metadata (same
          size and weight as the subtitle above it), not a read that came
          from asking AI. */}
      <Text muted size={0}>
        <SparklesIcon />
      </Text>
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
    </Flex>
  )

  // Same trigger/idle rules as `assessRow` above, and the same sparkle
  // marker — this is still AI-sourced, just the "action" half rather than
  // the "insight" half. The one real difference: a `'proposed'` (or
  // `'applying'`) result carries its own Apply/Dismiss right there on the
  // same line, since unlike `assess` this can actually change the document
  // — nothing here writes anything until Apply is clicked.
  const fixRow = onProposeFix && fix.status !== 'idle' && (
    <Flex align="center" gap={2} onClick={stopPropagation} wrap="wrap">
      <Text muted size={0}>
        <SparklesIcon />
      </Text>
      {fix.status === 'loading' && (
        <Text muted size={0}>
          {t('fix.loading')}
        </Text>
      )}
      {fix.status === 'none' && (
        <Text muted size={0}>
          {t('fix.none')}
        </Text>
      )}
      {(fix.status === 'proposed' || fix.status === 'applying') && (
        <>
          <Text muted size={0}>
            {fix.proposal.summary}
          </Text>
          <Button
            disabled={fix.status === 'applying'}
            fontSize={0}
            mode="bleed"
            onClick={handleApplyFix}
            padding={1}
            text={fix.status === 'applying' ? t('fix.applying') : t('fix.apply')}
            tone="primary"
          />
          <Button
            disabled={fix.status === 'applying'}
            fontSize={0}
            mode="bleed"
            onClick={handleDismissFix}
            padding={1}
            text={t('fix.dismiss')}
          />
        </>
      )}
      {fix.status === 'applied' && (
        <Text muted size={0}>
          {t('fix.applied')}
        </Text>
      )}
      {fix.status === 'error' && (
        <Text muted size={0}>
          {t('fix.error')}
        </Text>
      )}
    </Flex>
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
    // has no `assign` at all *and* no real assignee concept either (a todo,
    // a release) was never assignable to begin with, so there's no
    // "unassigned" to indicate. `assigneeReadOnly` is the one exception:
    // a real assignee concept this plugin just isn't allowed to edit (see
    // its own doc comment) still shows, same as an editable one would.
    if (!assignee && !canReassign && !assigneeReadOnly) return null

    const readOnlySuffix = assigneeReadOnly ? ` — ${t('assignee.readOnly')}` : ''

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
          style={
            canReassign
              ? {cursor: 'pointer', opacity: assignee ? 1 : 0.4}
              : assigneeReadOnly
                ? {cursor: 'not-allowed', opacity: assignee ? 1 : 0.4}
                : undefined
          }
          title={
            (assignee
              ? currentUser && assignee.id === currentUser.id
                ? t('assignee.you', {name: assignee.label})
                : assignee.label
              : t('assignee.unassigned')) + readOnlySuffix
          }
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
                    pressed={user.id === assignee?.id}
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

  // "Ask AI" goes first — reading before acting. Never for a `compact` row:
  // those have no menu at all today (every `aside` row — ambient context,
  // not a worklist), and `assess` isn't reason enough to grow one just for
  // this. "Fix with AI" only joins it when the source itself said this
  // particular item is one of the eligible ones (`item.fixable`) — offering
  // it everywhere and having it come back empty most of the time would read
  // as broken, not as a real capability.
  const allMenuActions = [
    ...(onAssess && !compact
      ? [{key: 'assess', label: t('assess.ask'), onClick: handleAssess}]
      : []),
    ...(onProposeFix && !compact && item.fixable
      ? [{key: 'fix', label: t('fix.ask'), onClick: handleProposeFix}]
      : []),
    ...(menuActions ?? []),
  ]

  // The same actions the bulk selection bar offers, reachable for just this
  // one row without ticking its checkbox first — the direct-manipulation
  // path the avatar's own reassign picker already established for `assign`.
  const menuButton = allMenuActions.length > 0 && (
    <Box onClick={stopPropagation}>
      <MenuButton
        button={
          <Button
            aria-label={t('row.menu')}
            icon={EllipsisVerticalIcon}
            mode="bleed"
            padding={2}
          />
        }
        id={`${labelId}-menu`}
        menu={
          <Menu>
            {allMenuActions.map((menuAction) => (
              <MenuItem
                key={menuAction.key}
                onClick={menuAction.onClick}
                text={menuAction.label}
                tone={menuAction.tone}
              />
            ))}
          </Menu>
        }
        popover={{placement: 'bottom-end', portal: true}}
      />
    </Box>
  )

  // Whether an assess and/or fix result actually renders below the title —
  // used to decide the row's own vertical alignment further down, not just
  // whether to render this block.
  const hasExtraRow = !compact && Boolean(assessRow || fixRow)

  const label = (
    // `minWidth: 0` at every flex level down to the text itself: a flex
    // item's default `min-width: auto` lets its content (an unbreakable
    // long URL, for a broken-link finding's own title) dictate a wider
    // minimum than the row actually has room for, so `textOverflow`
    // "ellipsis" below never got a chance to kick in — the row just forced
    // the whole card wider, past its own container, instead of truncating.
    <Stack flex={1} gap={2} style={{minWidth: 0}}>
      <Flex align="center" gap={2} style={{minWidth: 0}}>
        <Text
          id={labelId}
          muted={done}
          size={1}
          style={{minWidth: 0}}
          textOverflow="ellipsis"
          weight={compact ? undefined : 'medium'}
        >
          {item.title}
        </Text>
      </Flex>
      {(sourceLabel || item.subtitle || item.timestamp) && (
        <Text muted size={0} textOverflow="ellipsis">
          {sourceLabel}
          {sourceLabel && (item.subtitle || item.timestamp) ? ' · ' : ''}
          {item.subtitle}
          {item.subtitle && item.timestamp ? ' · ' : ''}
          {item.timestamp && <RelativeTime timestamp={item.timestamp} />}
        </Text>
      )}
      {hasExtraRow && (
        <Stack gap={2}>
          {assessRow}
          {fixRow}
        </Stack>
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
          <Box flex={1} style={{minWidth: 0}}>
          {label}
        </Box>
          {assigneeAvatar}
          {menuButton}
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
      {/* Centered normally — the common case is just a title and a
          subtitle line, and a top-aligned checkbox there floated away from
          the row's actual visual center. `flex-start` only once the assess
          row/remove link actually make this row taller than that (the same
          condition gating that block below): a vertically-centered checkbox
          on a taller row floats away from the title it labels instead. */}
      <Flex align={hasExtraRow ? 'flex-start' : 'center'} gap={2}>
        {checkbox}

        <Box flex={1} style={{minWidth: 0}}>
          {label}
        </Box>

        {assigneeAvatar}
        {menuButton}
      </Flex>
    </Card>
  )
}
