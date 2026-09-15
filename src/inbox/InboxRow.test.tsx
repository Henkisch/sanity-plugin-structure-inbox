import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {ToastProvider} from '@sanity/ui/toast'
import {cleanup, fireEvent, render, screen} from '@testing-library/react'
import {type ReactElement} from 'react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {AssessmentUnavailableError} from '../ai/assessment'
import {InboxRow} from './InboxRow'
import {type InboxItem} from './types'

afterEach(cleanup)

const navigateIntent = vi.fn()

// `renderWithTheme` wires the real router, whose `navigateIntent` throws for
// any route this test suite hasn't registered — exactly what earlier tests
// in this pane avoid exercising at all. Mocking the hook instead of the
// provider lets these assert on the call itself without a real route to
// resolve it against.
vi.mock('sanity/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity/router')>()
  return {...actual, useRouter: () => ({navigateIntent})}
})

// `useCurrentUser` (for the "(You)" tooltip suffix) needs a full Studio
// `source` context this suite does not build.
vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {...actual, useCurrentUser: () => null}
})

const theme = buildTheme()

function renderRow(ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  )
}

function item(extra: Partial<InboxItem> = {}): InboxItem {
  return {id: '1', title: 'Row title', ...extra}
}

describe('InboxRow', () => {
  it('opens the document on click when the item has an intent, instead of selecting it', () => {
    const onSelectedChange = vi.fn()

    renderRow(
      <InboxRow
        item={item({intent: {type: 'edit', params: {id: '1', type: 'post'}}})}
        onSelectedChange={onSelectedChange}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByText('Row title'))

    expect(navigateIntent).toHaveBeenCalledWith('edit', {id: '1', type: 'post'})
    expect(onSelectedChange).not.toHaveBeenCalled()
  })

  it('opens an edit dialog on click when the item has no intent but the source offers one', () => {
    const onEdit = vi.fn()
    const onSelectedChange = vi.fn()

    renderRow(
      <InboxRow
        item={item()}
        onEdit={onEdit}
        onSelectedChange={onSelectedChange}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByText('Row title'))

    expect(onEdit).toHaveBeenCalledWith(item())
    expect(onSelectedChange).not.toHaveBeenCalled()
    expect(navigateIntent).not.toHaveBeenCalled()
  })

  it('falls back to selecting the row on click when it has neither an intent nor an edit', () => {
    const onSelectedChange = vi.fn()

    renderRow(<InboxRow item={item()} onSelectedChange={onSelectedChange} selected={false} />)

    fireEvent.click(screen.getByText('Row title'))

    expect(onSelectedChange).toHaveBeenCalledWith(item(), true)
  })

  it('reassigns via the avatar without needing a bulk selection first', () => {
    const onReassign = vi.fn()
    const onSelectedChange = vi.fn()

    renderRow(
      <InboxRow
        assignableUsers={[{id: 'user-1', label: 'Ada'}]}
        item={item({assignee: {id: 'henrik', label: 'Henrik Larsson'}})}
        onReassign={onReassign}
        onSelectedChange={onSelectedChange}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByTitle('Henrik Larsson'))
    fireEvent.click(screen.getByText('Ada'))

    expect(onReassign).toHaveBeenCalledWith(item({assignee: {id: 'henrik', label: 'Henrik Larsson'}}), 'user-1')
    // Clicking the avatar to open the picker must not also select or open
    // the row underneath it.
    expect(onSelectedChange).not.toHaveBeenCalled()
    expect(navigateIntent).not.toHaveBeenCalled()
  })

  it('offers unassign only once there is an assignee, and only when the source supports it', () => {
    const onUnassign = vi.fn()

    renderRow(
      <InboxRow
        assignableUsers={[{id: 'user-1', label: 'Ada'}]}
        item={item({assignee: {id: 'henrik', label: 'Henrik Larsson'}})}
        onReassign={vi.fn()}
        onSelectedChange={vi.fn()}
        onUnassign={onUnassign}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByTitle('Henrik Larsson'))
    fireEvent.click(screen.getByText('assignee.unassign'))

    expect(onUnassign).toHaveBeenCalledWith(item({assignee: {id: 'henrik', label: 'Henrik Larsson'}}))
  })

  it('does not offer unassign for an item with no assignee yet, even if the source supports it', () => {
    renderRow(
      <InboxRow
        assignableUsers={[{id: 'user-1', label: 'Ada'}]}
        item={item()}
        onReassign={vi.fn()}
        onSelectedChange={vi.fn()}
        onUnassign={vi.fn()}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByTitle('assignee.unassigned'))

    expect(screen.queryByText('assignee.unassign')).toBeNull()
  })

  it('shows a faint placeholder avatar for an assignable item nobody has picked up yet', () => {
    const onReassign = vi.fn()

    renderRow(
      <InboxRow
        assignableUsers={[{id: 'user-1', label: 'Ada'}]}
        item={item()}
        onReassign={onReassign}
        onSelectedChange={vi.fn()}
        selected={false}
      />,
    )

    fireEvent.click(screen.getByTitle('assignee.unassigned'))
    fireEvent.click(screen.getByText('Ada'))

    expect(onReassign).toHaveBeenCalledWith(item(), 'user-1')
  })

  it('shows no avatar at all for an item whose source has no assign capability', () => {
    renderRow(<InboxRow item={item()} onSelectedChange={vi.fn()} selected={false} />)

    expect(screen.queryByTitle('assignee.unassigned')).toBeNull()
  })

  describe('assess', () => {
    function askAi() {
      fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
      fireEvent.click(screen.getByRole('menuitem', {name: 'assess.ask'}))
    }

    it('renders a resolved assessment with a tone', async () => {
      const onAssess = vi.fn().mockResolvedValue({message: 'Missing a hero image.', tone: 'critical'})

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      expect(await screen.findByText('Missing a hero image.')).toBeTruthy()
    })

    it('renders a resolved assessment with no tone', async () => {
      const onAssess = vi.fn().mockResolvedValue({message: 'Looks ready to publish.'})

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      expect(await screen.findByText('Looks ready to publish.')).toBeTruthy()
    })

    it('renders assess.unavailable, not assess.error, when the model answered but not usably', async () => {
      const onAssess = vi.fn().mockRejectedValue(new AssessmentUnavailableError())

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      expect(await screen.findByText('assess.unavailable')).toBeTruthy()
      expect(screen.queryByText('assess.error')).toBeNull()
    })

    it('renders assess.error for a plain transport failure', async () => {
      const onAssess = vi.fn().mockRejectedValue(new Error('network down'))

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      expect(await screen.findByText('assess.error')).toBeTruthy()
      expect(screen.queryByText('assess.unavailable')).toBeNull()
    })
  })
})
