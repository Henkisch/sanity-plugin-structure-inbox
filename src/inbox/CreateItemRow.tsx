import {Box, Button, Card, Flex, TextInput} from '@sanity/ui'
import {type SubmitEventHandler, useCallback, useState} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

interface CreateItemRowProps {
  onCreate: (title: string) => void
}

/**
 * The inline "add one" row for a source that keeps its own items — currently
 * only `todos`.
 *
 * A `<form>` rather than a button wired to the input by hand: it gets
 * Enter-to-submit for free, and clearing the field on submit is one line
 * instead of a ref.
 */
export function CreateItemRow(props: CreateItemRowProps) {
  const {onCreate} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const [value, setValue] = useState('')

  const handleSubmit = useCallback<SubmitEventHandler<HTMLFormElement>>(
    (event) => {
      event.preventDefault()
      const trimmed = value.trim()
      if (!trimmed) return
      onCreate(trimmed)
      setValue('')
    },
    [value, onCreate],
  )

  return (
    <Card borderBottom padding={2}>
      <form onSubmit={handleSubmit}>
        <Flex gap={2}>
          <Box flex={1}>
            <TextInput
              fontSize={1}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder={t('todos.addPlaceholder')}
              radius={2}
              value={value}
            />
          </Box>
          <Button disabled={!value.trim()} fontSize={1} text={t('todos.add')} type="submit" />
        </Flex>
      </form>
    </Card>
  )
}
