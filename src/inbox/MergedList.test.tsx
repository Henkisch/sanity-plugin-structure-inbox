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
  return {source: source(name, title), open: [], cleared: [], snoozed: [], ...overrides}
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
  view?: 'open' | 'cleared' | 'snoozed'
  dismissals?: Dismissals
  snoozes?: Snoozes
}) {
  const dismissals = props.dismissals ?? fakeDismissals()
  const snoozes = props.snoozes ?? fakeSnoozes()

  renderWithTheme(
    <MergedList
      assigneeFilter={new Set()}
      dismissals={dismissals}
      order={props.order}
      reports={props.reports}
      snoozes={snoozes}
      typeFilter={new Set()}
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
            assignee: {id: 'ada', label: 'Ada Lovelace'},
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

  it('resolves a real source for real and only acknowledges the one with no resolve', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined)
    const reports = {
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})], resolve}),
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['tasks', 'drafts']})

    selectItem('Task one')
    selectItem('Draft one')
    fireEvent.click(screen.getByText('action.markDone'))

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1))
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({id: 't1'}))
    // The task really resolved — it never gets dismissed/acknowledged, since
    // Sanity's own state is what will move it to Cleared next fetch. The
    // draft has no `resolve`, so it's the *only* one acknowledged.
    expect(dismissals.dismiss).toHaveBeenCalledTimes(1)
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1')
  })

  it("restores a cleared-view selection through each row's own source", () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {cleared: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {cleared: [item('t1', {title: 'Task one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts', 'tasks'], view: 'cleared'})

    selectItem('Draft one')
    selectItem('Task one')
    fireEvent.click(screen.getByText('action.markNotDone'))

    expect(dismissals.restore).toHaveBeenCalledWith('drafts', 'd1')
    expect(dismissals.restore).toHaveBeenCalledWith('tasks', 't1')
  })

  it('snoozes a selection regardless of which source it came from, and acknowledges it too', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    const {snoozes, dismissals} = renderList({reports, order: ['drafts', 'tasks']})

    selectItem('Draft one')
    selectItem('Task one')
    fireEvent.change(screen.getByDisplayValue('action.snooze'), {target: {value: 'tomorrow'}})

    // Snoozing fades the rows out first — see `EXIT_ANIMATION_MS` — so the
    // actual `snooze` calls land a beat after the picker fires.
    await vi.waitFor(() => expect(snoozes.snooze).toHaveBeenCalledTimes(2))
    expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String))
    expect(snoozes.snooze).toHaveBeenCalledWith('tasks', 't1', expect.any(String))

    // Snoozing also marks the item seen, so it doesn't read as freshly-unseen
    // the moment it wakes back into Open — see `plans/019-cleared-means-sanity-said-so.md`.
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1')
    expect(dismissals.dismiss).toHaveBeenCalledWith('tasks', 't1')
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
    // No `resolve` on this source, so the action bar offers "Acknowledge",
    // not "Mark as done" — see `SelectionActions.tsx`'s own doc comment.
    expect(screen.getByText('action.acknowledge')).toBeTruthy()
    expect(selectAll).toHaveProperty('checked', true)

    fireEvent.click(selectAll)
    await vi.waitFor(() => expect(screen.queryByText('action.acknowledge')).toBeNull())
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

  it('brings a mistakenly-acknowledged selection back with undo', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    // No `resolve` on this source, so the button reads "Acknowledge" — see
    // `SelectionActions.tsx`'s own doc comment on why the label depends on
    // `resolvableCount`.
    fireEvent.click(screen.getByText('action.acknowledge'))

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1'))

    fireEvent.click(await screen.findByText('selection.undo', {}, {timeout: 5000}))
    expect(dismissals.restore).toHaveBeenCalledWith('drafts', 'd1')
  })

  it('wakes a mistakenly-snoozed selection back with undo', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {snoozes, dismissals} = renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    fireEvent.change(screen.getByDisplayValue('action.snooze'), {target: {value: 'tomorrow'}})

    await vi.waitFor(() =>
      expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String)),
    )

    // A generous timeout, not the library default: this toast only appears
    // after `confirmSelection`'s own real `setTimeout(EXIT_ANIMATION_MS)`
    // resolves, and a slow, loaded test run can push that past the default
    // 1000ms window on its own, with nothing actually wrong.
    fireEvent.click(await screen.findByText('selection.undo', {}, {timeout: 5000}))
    expect(snoozes.wake).toHaveBeenCalledWith('drafts', 'd1')
    // Undo reverses the acknowledge-on-snooze too, not just the snooze itself.
    expect(dismissals.restore).toHaveBeenCalledWith('drafts', 'd1')
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

  it('offers "save to todos" only when exactly one source has create', () => {
    const create = vi.fn()
    const reports = {
      todos: report('todos', 'Todos', {create, open: [item('td1', {title: 'Todo one'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    renderList({reports, order: ['todos', 'tasks']})

    selectItem('Task one')
    expect(screen.getByText('action.saveToTodos')).toBeTruthy()

    selectItem('Todo one')
    expect(screen.getByText('action.saveToTodos')).toBeTruthy()
  })

  it('does not offer "save to todos" when zero or two-or-more sources have create', () => {
    const noCreators = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    renderList({reports: noCreators, order: ['drafts', 'tasks']})
    selectItem('Draft one')
    expect(screen.queryByText('action.saveToTodos')).toBeNull()
    cleanup()

    const twoCreators = {
      todos: report('todos', 'Todos', {create: vi.fn(), open: [item('td1', {title: 'Todo one'})]}),
      releases: report('releases', 'Releases', {
        create: vi.fn(),
        open: [item('r1', {title: 'Release one'})],
      }),
    }

    renderList({reports: twoCreators, order: ['todos', 'releases']})
    selectItem('Todo one')
    expect(screen.queryByText('action.saveToTodos')).toBeNull()
  })

  it("saves each selected row's title/description/dueBy to the sole creator, regardless of source", async () => {
    const create = vi.fn().mockResolvedValue(undefined)
    const reports = {
      todos: report('todos', 'Todos', {
        create,
        open: [item('td1', {title: 'Todo one', description: 'Todo desc'})],
      }),
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one', description: 'Draft desc'})],
      }),
      tasks: report('tasks', 'Tasks', {
        open: [item('t1', {title: 'Task one', dueBy: '2026-02-01'})],
      }),
    }

    renderList({reports, order: ['todos', 'drafts', 'tasks']})

    selectItem('Todo one')
    selectItem('Draft one')
    selectItem('Task one')
    fireEvent.click(screen.getByText('action.saveToTodos'))

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3))
    expect(create).toHaveBeenCalledWith({
      title: 'Todo one',
      description: 'Todo desc',
      dueBy: undefined,
    })
    expect(create).toHaveBeenCalledWith({
      title: 'Draft one',
      description: 'Draft desc',
      dueBy: undefined,
    })
    expect(create).toHaveBeenCalledWith({
      title: 'Task one',
      description: undefined,
      dueBy: '2026-02-01',
    })
  })

  it('clears the selection and shows an undo toast with the saved count', async () => {
    const create = vi.fn().mockResolvedValue(undefined)
    const reports = {
      todos: report('todos', 'Todos', {create}),
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }

    renderList({reports, order: ['todos', 'drafts']})

    selectItem('Draft one')
    selectItem('Draft two')
    fireEvent.click(screen.getByText('action.saveToTodos'))

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('undo.savedToTodos')).toBeTruthy()
    // The bar lingers briefly so its collapse can ease shut rather than snap
    // — see `useDelayedUnmount`.
    await vi.waitFor(() => expect(screen.queryByText('selection.count')).toBeNull())
  })

  it('does not render its own "add new" trigger — that now lives in Inbox.tsx\'s tab row', () => {
    const reports = {todos: report('todos', 'Todos', {create: vi.fn()})}

    renderList({reports, order: ['todos']})

    expect(screen.queryByText('todos.addButton')).toBeNull()
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
