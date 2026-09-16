import {SparklesIcon} from '@sanity/icons/Sparkles'
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

      {/* Every other read in this pane (Summarize, Suggest todos, Find
          content gaps, Scan for issues) is dismissible — this one wasn't,
          so its answer just sat there until a new question replaced it or
          the editor left the tab. Same plain-text "Dismiss" the rest use. */}
      {state.status === 'done' && (
        <Flex align="flex-start" gap={3} justify="space-between" paddingTop={2}>
          <Flex align="center" gap={2}>
            {/* Marks this line as AI-sourced at a glance — same treatment
                `InboxRow.tsx`'s own `assessRow` already gives a per-item
                AI read. */}
            <Text muted size={0}>
              <SparklesIcon />
            </Text>
            <Text muted size={1}>
              {state.matched ? state.reason : state.reason || t('ask.nothingMatched')}
            </Text>
          </Flex>
          <Button
            fontSize={1}
            mode="bleed"
            onClick={() => setState({status: 'idle'})}
            padding={2}
            style={{marginRight: -8, marginTop: -6}}
            text={t('ask.dismiss')}
          />
        </Flex>
      )}

      {state.status === 'unparseable' && (
        <Flex align="flex-start" gap={3} justify="space-between" paddingTop={2}>
          <Text muted size={1}>
            {t('ask.unparseable')}
          </Text>
          <Button
            fontSize={1}
            mode="bleed"
            onClick={() => setState({status: 'idle'})}
            padding={2}
            style={{marginRight: -8, marginTop: -6}}
            text={t('ask.dismiss')}
          />
        </Flex>
      )}

      {state.status === 'error' && (
        <Flex align="flex-start" gap={3} justify="space-between" paddingTop={2}>
          <Text muted size={1}>
            {t('ask.error')}
          </Text>
          <Button
            fontSize={1}
            mode="bleed"
            onClick={() => setState({status: 'idle'})}
            padding={2}
            style={{marginRight: -8, marginTop: -6}}
            text={t('ask.dismiss')}
          />
        </Flex>
      )}
    </Box>
  )
}
