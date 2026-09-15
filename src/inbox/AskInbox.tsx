import {Box, Button, Flex, Text, TextInput} from '@sanity/ui'
import {useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {describeRows, selectionFromResponse} from '../ai/askInbox'
import {promptJson} from '../ai/promptJson'
import {useAgentClient} from '../ai/useAgentClient'
import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type MergedRow} from './mergeItems'

interface AskInboxProps {
  /** Only rows currently on screen (already view- and filter-scoped) — the only candidates a question can select from. */
  rows: readonly MergedRow[]
  onSelect: (keys: string[]) => void
}

type AskState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; reason: string; matched: boolean}
  | {status: 'unparseable'}
  | {status: 'error'}

/**
 * A single-line "ask about these items" input for the Open view's own
 * header — see `StructureInboxConfig.ask`'s own doc comment for the whole
 * feature's design. Its only effect is `onSelect`: it never resolves,
 * dismisses, or snoozes anything, and the reason is always shown alongside
 * the selection so it stays reviewable rather than authoritative.
 */
export function AskInbox(props: AskInboxProps) {
  const {rows, onSelect} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const agentClient = useAgentClient()
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<AskState>({status: 'idle'})

  const handleSubmit = useCallback(async () => {
    const trimmed = question.trim()
    if (!trimmed || !agentClient) return

    setState({status: 'loading'})

    try {
      const described = describeRows(rows)
      const raw = await promptJson<unknown>(
        agentClient,
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
        setState({status: 'unparseable'})
        return
      }

      onSelect(selection.keys)
      setState({status: 'done', reason: selection.reason, matched: selection.keys.length > 0})
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] ask-the-inbox failed', error)
      setState({status: 'error'})
    }
  }, [question, agentClient, rows, onSelect])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') void handleSubmit()
    },
    [handleSubmit],
  )

  return (
    <Box>
      <Flex align="center" gap={2}>
        <Box flex={1}>
          <TextInput
            disabled={state.status === 'loading'}
            fontSize={1}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ask.placeholder')}
            value={question}
          />
        </Box>
        <Button
          disabled={state.status === 'loading' || !question.trim()}
          fontSize={1}
          mode="ghost"
          onClick={() => void handleSubmit()}
          text={state.status === 'loading' ? t('ask.loading') : t('ask.submit')}
        />
      </Flex>

      {state.status === 'done' && (
        <Box paddingTop={2}>
          <Text muted size={1}>
            {state.matched ? state.reason : state.reason || t('ask.nothingMatched')}
          </Text>
        </Box>
      )}

      {state.status === 'unparseable' && (
        <Box paddingTop={2}>
          <Text muted size={1}>
            {t('ask.unparseable')}
          </Text>
        </Box>
      )}

      {state.status === 'error' && (
        <Box paddingTop={2}>
          <Text muted size={1}>
            {t('ask.error')}
          </Text>
        </Box>
      )}
    </Box>
  )
}
