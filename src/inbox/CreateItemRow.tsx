import {AddIcon} from '@sanity/icons/Add'
import {Box, Button, Dialog, Flex, Stack, Text, TextArea, TextInput} from '@sanity/ui'
import {type SubmitEventHandler, useCallback, useId, useRef, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type CreateItemInput} from './types'

interface CreateItemRowProps {
  onCreate: (input: CreateItemInput) => void
}

/**
 * The "add one" control for a source that keeps its own items — currently
 * only `todos`.
 *
 * Collapsed to a plain **+ Add todo** button until clicked: a text input
 * sitting open above the list at all times, whether or not anyone was about
 * to type into it, was exactly the kind of permanent, unused control this
 * redesign was meant to get rid of everywhere else. Clicking it opens a
 * dialog rather than expanding inline, because there are now three fields to
 * fill — title, an optional description, an optional due date — more than an
 * inline row above the list has room for.
 */
export function CreateItemRow(props: CreateItemRowProps) {
  const {onCreate} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dialogId = useId()
  const formId = `${dialogId}-form`

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Uncontrolled, unlike the two fields above: a date input's `.value` is
  // only ever a complete date or an empty string, never a partial one, so a
  // `value` prop bound to state stays `""` for every keystroke of a date
  // that isn't finished yet — fighting the input's own segment-by-segment
  // editing (month, day, year) on every render in between. Reading it once,
  // at submit, sidesteps that entirely.
  const dueByRef = useRef<HTMLInputElement>(null)

  const openDialog = useCallback(() => setOpen(true), [])

  const closeDialog = useCallback(() => {
    setOpen(false)
    setTitle('')
    setDescription('')
    // Nothing to reset for the due date: it's read straight off the DOM node
    // in `dueByRef`, and that node unmounts with the dialog — a fresh, empty
    // one is created the next time it opens.
  }, [])

  const handleSubmit = useCallback<SubmitEventHandler<HTMLFormElement>>(
    (event) => {
      event.preventDefault()
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      onCreate({
        title: trimmedTitle,
        description: description.trim() || undefined,
        dueBy: dueByRef.current?.value || undefined,
      })
      closeDialog()
    },
    [title, description, onCreate, closeDialog],
  )

  return (
    <>
      {/* A bare `<Button>` here stretched to the full row width (its parent
          `Stack` is a flex column, which stretches block children by
          default) and then centred its own label inside that width — a
          `Flex` row sizes it to its content instead, so it sits flush left
          like every other control in the list. */}
      <Flex>
        <Button
          fontSize={1}
          icon={AddIcon}
          mode="bleed"
          onClick={openDialog}
          padding={2}
          text={t('todos.addButton')}
        />
      </Flex>

      {open && (
        <Dialog
          header={t('todos.addButton')}
          id={dialogId}
          onClose={closeDialog}
          footer={
            <Box padding={3}>
              <Flex gap={2} justify="flex-end">
                <Button mode="bleed" onClick={closeDialog} text={t('selection.cancel')} />
                <Button
                  disabled={!title.trim()}
                  form={formId}
                  text={t('todos.add')}
                  tone="positive"
                  type="submit"
                />
              </Flex>
            </Box>
          }
          width={1}
        >
          <Box padding={4}>
            <form id={formId} onSubmit={handleSubmit}>
              <Stack gap={4}>
                <Stack gap={2}>
                  <Text size={1} weight="medium">
                    {t('todos.titleLabel')}
                  </Text>
                  <TextInput
                    autoFocus
                    fontSize={1}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    placeholder={t('todos.addPlaceholder')}
                    value={title}
                  />
                </Stack>

                <Stack gap={2}>
                  <Text size={1} weight="medium">
                    {t('todos.descriptionLabel')}
                  </Text>
                  <TextArea
                    fontSize={1}
                    onChange={(event) => setDescription(event.currentTarget.value)}
                    placeholder={t('todos.descriptionPlaceholder')}
                    rows={3}
                    value={description}
                  />
                </Stack>

                <Stack gap={2}>
                  <Text size={1} weight="medium">
                    {t('todos.dueByLabel')}
                  </Text>
                  <TextInput fontSize={1} ref={dueByRef} type="date" />
                </Stack>
              </Stack>
            </form>
          </Box>
        </Dialog>
      )}
    </>
  )
}
