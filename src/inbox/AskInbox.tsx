import {Box, Button, Flex, TextInput} from '@sanity/ui'
import {useCallback, useRef, useState} from 'react'
import {useTranslation} from 'sanity'

import {describeRows, selectionFromResponse} from '../ai/askInbox'
import {promptJson} from '../ai/promptJson'
import {useAgentClient} from '../ai/useAgentClient'
import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type MergedRow} from './mergeItems'

/** @public */
export type AskState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; reason: string; matched: boolean}
  | {status: 'unparseable'}
  | {status: 'error'}

interface AskInboxProps {
  /** Only rows currently on screen (already view- and filter-scoped) — the only candidates a question can select from. */
  rows: readonly MergedRow[]
  onSelect: (keys: string[]) => void
  /** See `StructureInboxConfig.context`'s own doc comment. */
  context?: string
  /**
   * Owned by `Inbox.tsx`, not this component — its answer renders as
   * another dismissible card in `mainColumnResults`, the same shape
   * Summarize/Suggest todos/Find content gaps already use, rather than
   * squeezed into this input's own row inside the checkbox/filter
   * header. See `Inbox.tsx`'s own `askResult` for where this state
   * actually lives and renders.
   */
  result: AskState
  onResultChange: (state: AskState) => void
}

/**
 * A single-line "ask about these items" input for the Open view's own
 * header — see `StructureInboxConfig.ask`'s own doc comment for the whole
 * feature's design. Its only effect is `onSelect`: it never resolves,
 * dismisses, or snoozes anything, and the reason is always shown alongside
 * the selection so it stays reviewable rather than authoritative.
 */
export function AskInbox(props: AskInboxProps) {
  const {rows, onSelect, context, result, onResultChange} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const agentClient = useAgentClient()
  const [question, setQuestion] = useState('')
  const submitRequestRef = useRef(0)

  const handleSubmit = useCallback(async () => {
    const trimmed = question.trim()
    if (!trimmed || !agentClient) return

    const requestId = ++submitRequestRef.current
    onResultChange({status: 'loading'})

    try {
      const described = describeRows(rows)
      const raw = await promptJson<unknown>(
        agentClient,
        (context ? `About this project: ${context}\n---\n` : '') +
          'Given this list of inbox items, one per line as JSON:\n$items\n---\n' +
          'A question about them: "' +
          trimmed +
          '"\n' +
          'Reply with JSON only, no prose and no code fences: ' +
          '{"keys": [<the "key" of every item that matches, chosen only from the list above>], ' +
          '"reason": "<one short sentence explaining the selection>"}. ' +
          'If nothing matches, return {"keys": [], "reason": "<why nothing matched>"}.',
        {items: JSON.stringify(described)},
      )

      const selection = selectionFromResponse(raw, rows)
      if (!selection) {
        if (requestId === submitRequestRef.current) onResultChange({status: 'unparseable'})
        return
      }

      if (requestId === submitRequestRef.current) {
        onSelect(selection.keys)
        onResultChange({status: 'done', reason: selection.reason, matched: selection.keys.length > 0})
      }
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] ask-the-inbox failed', error)
      if (requestId === submitRequestRef.current) onResultChange({status: 'error'})
    }
  }, [question, agentClient, rows, onSelect, context, onResultChange])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') void handleSubmit()
    },
    [handleSubmit],
  )

  return (
    <Box>
      <Flex align="center" gap={2}>
        {/* `minWidth`, not just `flex={1}`: this box's own grid column
            (`HeaderGrid`'s `ask` area, in `MergedList.tsx`) is a bare `1fr`
            track sharing the row with the selection bar's own `auto`-sized
            content — a `flex={1}` child with no floor happily shrinks all
            the way to near-zero once that bar gets busy (Suggest + Assign,
            say), rather than wrapping or reserving anything usable.
            Confirmed live: this input rendered at 56px, its placeholder
            fully hidden, at a container width where the selection bar's
            own content was just wide enough to squeeze it. A floor here
            means the *worst* case is a tight-but-legible input, never an
            invisible one. */}
        <Box flex={1} style={{minWidth: 140}}>
          <TextInput
            disabled={result.status === 'loading'}
            fontSize={1}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ask.placeholder')}
            value={question}
          />
        </Box>
        <Button
          disabled={result.status === 'loading' || !question.trim()}
          fontSize={1}
          mode="ghost"
          onClick={() => void handleSubmit()}
          text={result.status === 'loading' ? t('ask.loading') : t('ask.submit')}
        />
      </Flex>
    </Box>
  )
}
