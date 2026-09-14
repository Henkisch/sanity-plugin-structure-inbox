import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {renderWithTheme} from '../test/renderWithTheme'
import {CreateItemRow} from './CreateItemRow'

afterEach(cleanup)

describe('CreateItemRow', () => {
  it('creates an item with just a title', () => {
    const create = vi.fn()
    renderWithTheme(<CreateItemRow onCreate={create} />)

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'New todo'},
    })
    fireEvent.click(screen.getByText('todos.add'))

    expect(create).toHaveBeenCalledWith({title: 'New todo', description: undefined, dueBy: undefined})
  })

  it('includes a description and due date when filled in', () => {
    const create = vi.fn()
    renderWithTheme(<CreateItemRow onCreate={create} />)

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'New todo'},
    })
    fireEvent.change(screen.getByPlaceholderText('todos.descriptionPlaceholder'), {
      target: {value: 'Some detail'},
    })
    fireEvent.change(screen.getByDisplayValue(''), {target: {value: '2026-02-01'}})
    fireEvent.click(screen.getByText('todos.add'))

    expect(create).toHaveBeenCalledWith({
      title: 'New todo',
      description: 'Some detail',
      dueBy: '2026-02-01',
    })
  })

  it('closes the dialog without creating anything on cancel', () => {
    const create = vi.fn()
    renderWithTheme(<CreateItemRow onCreate={create} />)

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'Abandoned'},
    })
    fireEvent.click(screen.getByText('selection.cancel'))

    expect(screen.queryByPlaceholderText('todos.addPlaceholder')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('hides the trigger button when hideTrigger is set, without affecting editing', () => {
    const onSave = vi.fn()
    renderWithTheme(
      <CreateItemRow
        editing={{key: 't1', title: 'Write docs', onSave, onCancel: vi.fn()}}
        hideTrigger
        onCreate={vi.fn()}
      />,
    )

    expect(screen.queryByText('todos.addButton')).toBeNull()
    expect(screen.getByDisplayValue('Write docs')).toBeTruthy()

    fireEvent.click(screen.getByText('todos.save'))
    expect(onSave).toHaveBeenCalledWith({title: 'Write docs', description: undefined, dueBy: undefined})
  })
})
