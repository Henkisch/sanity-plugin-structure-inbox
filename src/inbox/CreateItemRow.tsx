import {AddIcon} from '@sanity/icons/Add'
import {Box, Button, Dialog, Flex, Stack, Text, TextArea, TextInput} from '@sanity/ui'
import {type SubmitEventHandler, useCallback, useEffect, useId, useRef, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import {type CreateItemInput} from './types'

/**
 * An existing item to edit instead of a blank one to create — set by a row
 * with nowhere else to send an edit click (a todo has no document to open).
 * `key` identifies which item this is purely so the dialog knows when to
 * reseed its fields from a *different* item — comparing the object itself
 * would also fire on every parent re-render that happens to construct a new
 * (but equal) object.
 */
interface EditingItem {
  key: string
  title: string
  description?: string
  dueBy?: string
  onSave: (input: CreateItemInput) => void
  onCancel: () => void
}

interface CreateItemRowProps {
  onCreate: (input: CreateItemInput) => void
  editing?: EditingItem
}

/**
 * The "add one" control for a source that keeps its own items — currently
 * only `todos`. Also the "edit one" dialog for the same source, opened
 * externally via `editing` rather than the button below.
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
  const {onCreate, editing} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dialogId = useId()
  const formId = `${dialogId}-form`

  const [internalOpen, setInternalOpen] = useState(false)
  const open = internalOpen || Boolean(editing)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Uncontrolled, unlike the two fields above: a date input's `.value` is
  // only ever a complete date or an empty string, never a partial one, so a
  // `value` prop bound to state stays `""` for every keystroke of a date
  // that isn't finished yet — fighting the input's own segment-by-segment
  // editing (month, day, year) on every render in between. Reading it once,
  // at submit, sidesteps that entirely.
  const dueByRef = useRef<HTMLInputElement>(null)

  const openDialog = useCallback(() => setInternalOpen(true), [])

  const closeDialog = useCallback(() => {
    editing?.onCancel()
    setInternalOpen(false)
    setTitle('')
    setDescription('')
    // Nothing to reset for the due date: it's read straight off the DOM node
    // in `dueByRef`, and that node unmounts with the dialog — a fresh, empty
    // one is created the next time it opens.
  }, [editing])

  // Seeded once per edit target, keyed on `editing.key` (a plain string)
  // rather than running whenever `editing` itself changes reference — the
  // exact "compare by identity on a value that isn't guaranteed stable" trap
  // the selection bar's collapse animation hit elsewhere in this pane.
  // Adjusted directly during render (React's own sanctioned way to react to
  // a changed prop) rather than in an effect, since these two are React
  // state — only the due date below, an imperative DOM write, belongs in one.
  const [seededKey, setSeededKey] = useState(editing?.key)
  if (editing && editing.key !== seededKey) {
    setSeededKey(editing.key)
    setTitle(editing.title)
    setDescription(editing.description ?? '')
  }

  useEffect(() => {
    // Only when there's an actual date to seed — setting `.value = ''`
    // scripted a native date input into a visibly blank state on mobile
    // Safari (no "yyyy-mm-dd" placeholder, no calendar glyph), unlike one
    // simply left untouched. The field is inside `Dialog`, which unmounts
    // when it closes, so a fresh instance of `dueByRef` is guaranteed the
    // next time this opens — there's no stale value from a previous edit
    // left to worry about clearing.
    if (editing?.dueBy && dueByRef.current) dueByRef.current.value = editing.dueBy
    // Keyed on `editing?.key`, not `editing` itself: the parent constructs a
    // new `editing` object on every one of its own renders, and re-running
    // this on every one of those would stomp a due date mid-edit back to its
    // original value each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.key])

  const handleSubmit = useCallback<SubmitEventHandler<HTMLFormElement>>(
    (event) => {
      event.preventDefault()
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      const input: CreateItemInput = {
        title: trimmedTitle,
        description: description.trim() || undefined,
        dueBy: dueByRef.current?.value || undefined,
      }

      if (editing) editing.onSave(input)
      else onCreate(input)

      setInternalOpen(false)
      setTitle('')
      setDescription('')
    },
    [title, description, editing, onCreate],
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
          header={editing ? t('todos.editButton') : t('todos.addButton')}
          id={dialogId}
          onClose={closeDialog}
          footer={
            <Box padding={3}>
              <Flex gap={2} justify="flex-end">
                <Button mode="bleed" onClick={closeDialog} text={t('selection.cancel')} />
                <Button
                  disabled={!title.trim()}
                  form={formId}
                  text={editing ? t('todos.save') : t('todos.add')}
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
