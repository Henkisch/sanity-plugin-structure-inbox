import {Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useId, useState} from 'react'
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
  onSelectedChange: (item: InboxItem, selected: boolean) => void
  /** The source's `assess`, if it has one — see `InboxSourceResult.assess`. */
  onAssess?: (item: InboxItem) => Promise<string>
  /** The source's `remove`, if it has one — see `InboxSourceResult.remove`. */
  onRemove?: (item: InboxItem) => Promise<void> | void
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

export function InboxRow(props: InboxRowProps) {
  const {
    item,
    compact = false,
    done = false,
    selected,
    onSelectedChange,
    onAssess,
    onRemove,
    sourceLabel,
  } = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const {navigateIntent} = useRouter()
  const labelId = useId()
  const [assessment, setAssessment] = useState<Assessment>({status: 'idle'})

  const handleOpen = useCallback(() => {
    if (!item.intent) return
    navigateIntent(item.intent.type, item.intent.params)
  }, [item.intent, navigateIntent])

  // Checking a box marks the row, it does not act on it. Which action follows
  // is the editor's next decision, offered once something is selected — the
  // same order a mail client puts them in, and the reason a tick that silently
  // completed things felt wrong.
  const handleSelect = useCallback(
    () => onSelectedChange(item, !selected),
    [item, onSelectedChange, selected],
  )

  const handleAssess = useCallback(() => {
    if (!onAssess) return
    setAssessment({status: 'loading'})
    onAssess(item)
      .then((message) => setAssessment({status: 'done', message}))
      .catch(() => setAssessment({status: 'done', message: t('assess.error')}))
  }, [onAssess, item, t])

  // No local status to track on success: the row that just deleted itself is
  // about to unmount as the parent re-renders without it. A failure has
  // nowhere to show itself on a row that may no longer exist, so it goes to
  // the console instead, the same as a failed resolve or assign elsewhere in
  // this pane.
  const handleRemove = useCallback(() => {
    Promise.resolve(onRemove?.(item)).catch((error: unknown) => {
      console.error('[sanity-plugin-structure-inbox] could not remove item', error)
    })
  }, [onRemove, item])

  // A done row drops its own tone: the point of showing it is that it is
  // finished, and a caution-coloured finished row still reads as urgent.
  const tone = done || item.tone === 'default' ? undefined : item.tone

  const checkbox = (
    <Flex align="center" paddingLeft={1} paddingRight={compact ? 1 : 2}>
      <Checkbox
        aria-labelledby={labelId}
        checked={selected}
        onChange={handleSelect}
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
      {/* Only once selected: a permanent "Ask AI" (or "Delete") under every
          row was the thing that made the list feel busy rather than clear. */}
      {!compact && selected && (assessRow || removeRow) && (
        <Flex gap={3}>
          {assessRow}
          {removeRow}
        </Flex>
      )}
    </Stack>
  )

  if (compact) {
    return (
      <Card padding={2} radius={2} tone={selected ? 'primary' : tone}>
        <Flex align="center" gap={1}>
          {checkbox}
          <Box flex={1}>{label}</Box>
        </Flex>
      </Card>
    )
  }

  return (
    <Card padding={2} radius={2} tone={selected ? 'primary' : tone}>
      {/* `flex-start`, not `center`: the assess row can make this taller than
          a single line, and a vertically-centered checkbox then floats away
          from the title it labels. */}
      <Flex align="flex-start" gap={2}>
        {checkbox}

        <Box flex={1}>{label}</Box>

        {item.intent && !done && (
          <Button
            fontSize={1}
            mode="bleed"
            onClick={handleOpen}
            padding={2}
            text={t('item.open')}
          />
        )}
      </Flex>
    </Card>
  )
}
