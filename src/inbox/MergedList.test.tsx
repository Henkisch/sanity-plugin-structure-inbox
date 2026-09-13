import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {renderWithTheme} from '../test/renderWithTheme'
import {MergedList} from './MergedList'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxSource} from './types'

afterEach(cleanup)

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {...actual, useRelativeTime: () => 'a while ago'}
})

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function source(name: string, title: string): InboxSource {
  return {name, title, useItems: () => ({items: []})}
}

function report(name: string, title: string, overrides: Partial<SourceReport> = {}): SourceReport {
  return {source: source(name, title), open: [], done: [], snoozed: [], ...overrides}
}

function fakeDismissals(): Dismissals {
  return {state: EMPTY_DISMISSALS, dismiss: vi.fn(), restore: vi.fn()}
}

function fakeSnoozes(): Snoozes {
  return {state: EMPTY_SNOOZES, snooze: vi.fn(), wake: vi.fn()}
}

function selectItem(title: string) {
  const labelId = screen.getByText(title).closest('[id]')?.id
  const checkbox = document.querySelector<HTMLInputElement>(`input[aria-labelledby="${labelId}"]`)
  if (!checkbox) throw new Error(`no checkbox labelled by "${title}"`)
  fireEvent.click(checkbox)
}

function renderList(props: {
  reports: Record<string, SourceReport>
  order: string[]
  view?: 'open' | 'done' | 'snoozed'
  dismissals?: Dismissals
  snoozes?: Snoozes
}) {
  const dismissals = props.dismissals ?? fakeDismissals()
  const snoozes = props.snoozes ?? fakeSnoozes()

  renderWithTheme(
    <MergedList
      dismissals={dismissals}
      order={props.order}
      reports={props.reports}
      snoozes={snoozes}
      view={props.view ?? 'open'}
    />,
  )

  return {dismissals, snoozes}
}

describe('MergedList', () => {
  it('merges items from every source into one sorted list', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {tone: 'default'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {tone: 'critical'})]}),
    }

    renderList({reports, order: ['drafts', 'tasks']})

    const titles = screen.getAllByText(/^Item /).map((el) => el.textContent)
    // Critical (tasks) sorts before default (drafts), regardless of `order`.
    expect(titles).toEqual(['Item t1', 'Item d1'])
  })

  it('shows an assignee avatar instead of restating the audience in text', () => {
    const reports = {
      tasks: report('tasks', 'Your tasks', {
        open: [
          item('t1', {
            title: 'Follow up',
            assignee: {label: 'Ada Lovelace'},
          }),
        ],
      }),
    }

    renderList({reports, order: ['tasks']})

    expect(screen.getByTitle('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('AL')).toBeTruthy()
    expect(screen.getByText(/Your tasks/)).toBeTruthy()
    expect(screen.queryByText(/audience\./)).toBeNull()
  })

  it('tags each row with its own source', () => {
    const reports = {
      drafts: report('drafts', 'Unpublished drafts', {
        open: [item('d1')],
        source: source('drafts', 'Unpublished drafts'),
      }),
    }

    renderList({reports, order: ['drafts']})

    expect(screen.getByText(/Unpublished drafts/)).toBeTruthy()
  })

  it('marks a mixed selection done, calling resolve only where the source has one', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined)
    const reports = {
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})], resolve}),
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['tasks', 'drafts']})

    selectItem('Task one')
    selectItem('Draft one')
    fireEvent.click(screen.getByText('action.markDone'))

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledTimes(2))
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({id: 't1'}))
    expect(dismissals.dismiss).toHaveBeenCalledWith('tasks', 't1')
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1')
  })

  it("restores a done-view selection through each row's own source", () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {done: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {done: [item('t1', {title: 'Task one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts', 'tasks'], view: 'done'})

    selectItem('Draft one')
    selectItem('Task one')
    fireEvent.click(screen.getByText('action.markNotDone'))

    expect(dismissals.restore).toHaveBeenCalledWith('drafts', 'd1')
    expect(dismissals.restore).toHaveBeenCalledWith('tasks', 't1')
  })

  it('snoozes a selection regardless of which source it came from', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    const {snoozes} = renderList({reports, order: ['drafts', 'tasks']})

    selectItem('Draft one')
    selectItem('Task one')
    fireEvent.change(screen.getByDisplayValue('action.snooze'), {target: {value: 'tomorrow'}})

    // Snoozing fades the rows out first — see `EXIT_ANIMATION_MS` — so the
    // actual `snooze` calls land a beat after the picker fires.
    await vi.waitFor(() => expect(snoozes.snooze).toHaveBeenCalledTimes(2))
    expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String))
    expect(snoozes.snooze).toHaveBeenCalledWith('tasks', 't1', expect.any(String))
  })

  it('selects a row by clicking anywhere on it, not just its checkbox', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Click me'})]}),
    }

    renderList({reports, order: ['drafts']})

    fireEvent.click(screen.getByText('Click me'))
    expect(screen.getByText('selection.count')).toBeTruthy()

    fireEvent.click(screen.getByText('Click me'))
    // The bar lingers briefly so its collapse can ease shut rather than snap
    // — see `useDelayedUnmount`.
    await vi.waitFor(() => expect(screen.queryByText('selection.count')).toBeNull())
  })

  it('suppresses per-row ask AI and delete once more than one row is selected', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
        assess: vi.fn(),
        remove: vi.fn(),
      }),
    }

    renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    expect(screen.getByText('assess.ask')).toBeTruthy()
    expect(screen.getByText('action.delete')).toBeTruthy()

    selectItem('Draft two')
    expect(screen.queryByText('assess.ask')).toBeNull()
    expect(screen.queryByText('action.delete')).toBeNull()
  })

  it('selects and clears every row from the select-all header', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }

    renderList({reports, order: ['drafts']})

    const selectAll = screen.getByTitle('selection.selectAll')
    fireEvent.click(selectAll)
    expect(screen.getByText('action.markDone')).toBeTruthy()
    expect(selectAll).toHaveProperty('checked', true)

    fireEvent.click(selectAll)
    await vi.waitFor(() => expect(screen.queryByText('action.markDone')).toBeNull())
  })

  it('marks the select-all header indeterminate when only some rows are selected', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }

    renderList({reports, order: ['drafts']})

    selectItem('Draft one')

    const selectAll = screen.getByTitle<HTMLInputElement>('selection.selectAll')
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(true)
  })

  it('brings a mistakenly-completed selection back with undo', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    fireEvent.click(screen.getByText('action.markDone'))

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1'))

    fireEvent.click(await screen.findByText('selection.undo'))
    expect(dismissals.restore).toHaveBeenCalledWith('drafts', 'd1')
  })

  it('wakes a mistakenly-snoozed selection back with undo', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {snoozes} = renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    fireEvent.change(screen.getByDisplayValue('action.snooze'), {target: {value: 'tomorrow'}})

    await vi.waitFor(() =>
      expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String)),
    )

    fireEvent.click(await screen.findByText('selection.undo'))
    expect(snoozes.wake).toHaveBeenCalledWith('drafts', 'd1')
  })

  it('confirms who a selection was assigned to, so a click landing is never a guess', async () => {
    const toUser = vi.fn().mockResolvedValue(undefined)
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'})],
        assign: {users: [{id: 'user-1', label: 'Ada'}], toUser},
      }),
    }

    renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    fireEvent.change(screen.getByDisplayValue('action.assign'), {target: {value: 'user-1'}})

    await vi.waitFor(() => expect(toUser).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('undo.assigned')).toBeTruthy()
  })

  it('offers assign only when every selected row shares one source', () => {
    const toUser = vi.fn().mockResolvedValue(undefined)
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
        assign: {users: [{id: 'user-1', label: 'Ada'}], toUser},
      }),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    renderList({reports, order: ['drafts', 'tasks']})

    selectItem('Draft one')
    selectItem('Draft two')
    expect(screen.getByText('action.assign')).toBeTruthy()

    selectItem('Task one')
    expect(screen.queryByText('action.assign')).toBeNull()
  })

  it('renders a create row per source that offers one, only in the open view', () => {
    const create = vi.fn()
    const reports = {
      todos: report('todos', 'Todos', {create}),
    }

    renderList({reports, order: ['todos']})

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'New todo'},
    })
    fireEvent.click(screen.getByText('todos.add'))

    expect(create).toHaveBeenCalledWith({
      title: 'New todo',
      description: undefined,
      dueBy: undefined,
    })
  })

  it('opens a pre-filled edit dialog when a row is clicked, and saves through update', () => {
    const update = vi.fn()
    const reports = {
      todos: report('todos', 'Todos', {
        open: [item('t1', {title: 'Write docs', description: 'Draft notes', dueBy: '2026-02-01'})],
        create: vi.fn(),
        update,
      }),
    }

    renderList({reports, order: ['todos']})

    fireEvent.click(screen.getByText('Write docs'))

    expect(screen.getByText('todos.editButton')).toBeTruthy()
    expect(screen.getByDisplayValue('Write docs')).toBeTruthy()
    expect(screen.getByDisplayValue('Draft notes')).toBeTruthy()
    expect(screen.getByDisplayValue('2026-02-01')).toBeTruthy()

    fireEvent.change(screen.getByDisplayValue('Write docs'), {
      target: {value: 'Write the docs'},
    })
    fireEvent.click(screen.getByText('todos.save'))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({id: 't1'}), {
      title: 'Write the docs',
      description: 'Draft notes',
      dueBy: '2026-02-01',
    })
    expect(screen.queryByText('todos.editButton')).toBeNull()
  })

  it('includes a description and due date when filled in', () => {
    const create = vi.fn()
    const reports = {todos: report('todos', 'Todos', {create})}

    renderList({reports, order: ['todos']})

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
    const reports = {todos: report('todos', 'Todos', {create})}

    renderList({reports, order: ['todos']})

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'Abandoned'},
    })
    fireEvent.click(screen.getByText('selection.cancel'))

    expect(screen.queryByPlaceholderText('todos.addPlaceholder')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('hides create rows outside the open view', () => {
    const reports = {todos: report('todos', 'Todos', {create: vi.fn()})}

    renderList({reports, order: ['todos'], view: 'done'})

    expect(screen.queryByText('todos.addButton')).toBeNull()
  })

  it('shows an inline error for a source that reported one, without hiding the rest', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {error: new Error('boom')}),
    }

    renderList({reports, order: ['drafts', 'tasks']})

    expect(screen.getByText(/boom/)).toBeTruthy()
    expect(screen.getByText('Draft one')).toBeTruthy()
  })

  it('shows the view-specific empty copy once every source has reported and none has rows', () => {
    const reports = {drafts: report('drafts', 'Drafts')}

    renderList({reports, order: ['drafts'], view: 'snoozed'})

    expect(screen.getByText('source.noneSnoozed')).toBeTruthy()
  })

  it('shows loading while a configured source has not reported yet', () => {
    renderList({reports: {}, order: ['drafts']})

    expect(screen.getByText('source.loading')).toBeTruthy()
  })
})
