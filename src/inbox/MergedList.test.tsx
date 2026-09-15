import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS, withDismissal} from '../store/dismissals'
import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {renderWithTheme} from '../test/renderWithTheme'
import {MergedList} from './MergedList'
import {type SourceReport} from './SourceFeed'
import {type InboxItem, type InboxSource} from './types'

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  // `InboxRow` calls `useCurrentUser` (for the "(You)" tooltip suffix), which
  // needs a full Studio `source` context this suite does not build.
  return {...actual, useRelativeTime: () => 'a while ago', useCurrentUser: () => null}
})

// `AskInbox` calls `useAgentClient` (itself a `useClient` wrapper needing a
// real Studio context this suite does not build) and `promptJson` (a real
// network call) — both mocked at the module level so the "ask the inbox"
// tests below can control the answer directly, the same way `onAssess` is
// injected as a plain mock function everywhere else in this file.
const {useAgentClientMock, promptJsonMock} = vi.hoisted(() => ({
  useAgentClientMock: vi.fn(() => ({}) as never),
  promptJsonMock: vi.fn(),
}))

vi.mock('../ai/useAgentClient', () => ({useAgentClient: useAgentClientMock}))
vi.mock('../ai/promptJson', () => ({promptJson: promptJsonMock}))

afterEach(() => {
  cleanup()
  promptJsonMock.mockReset()
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

/** Opens a row's own three-dot menu without selecting it — only safe to use with a single row on screen, since the trigger's own label ("row.menu") is not per-row. */
function openRowMenu() {
  fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
}

function renderList(props: {
  reports: Record<string, SourceReport>
  order: string[]
  view?: 'open' | 'cleared' | 'snoozed'
  dismissals?: Dismissals
  snoozes?: Snoozes
  ask?: boolean
}) {
  const dismissals = props.dismissals ?? fakeDismissals()
  const snoozes = props.snoozes ?? fakeSnoozes()

  renderWithTheme(
    <MergedList
      ask={props.ask}
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

  it('resolves a real source for real and only clears the one with no resolve', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined)
    const reports = {
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})], resolve}),
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['tasks', 'drafts']})

    selectItem('Task one')
    selectItem('Draft one')
    // `getByRole('button', ...)`, not `getByText`: each row now also has its
    // own three-dot menu item with the same label, hidden in its own popover
    // markup — this disambiguates the bulk selection bar's actual button.
    fireEvent.click(screen.getByRole('button', {name: 'action.markDone'}))

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1))
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({id: 't1'}))
    // The task really resolved — it never gets dismissed/cleared manually,
    // since Sanity's own state is what will move it to Cleared next fetch.
    // The draft has no `resolve`, so it's the *only* one cleared manually.
    expect(dismissals.dismiss).toHaveBeenCalledTimes(1)
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1')
  })

  it("reopens a cleared-view selection through each row's own source", async () => {
    const reopenDraft = vi.fn().mockResolvedValue(undefined)
    const reopenTask = vi.fn().mockResolvedValue(undefined)
    const reports = {
      drafts: report('drafts', 'Drafts', {
        cleared: [item('d1', {title: 'Draft one'})],
        reopen: reopenDraft,
      }),
      tasks: report('tasks', 'Tasks', {cleared: [item('t1', {title: 'Task one'})], reopen: reopenTask}),
    }

    renderList({reports, order: ['drafts', 'tasks'], view: 'cleared'})

    selectItem('Draft one')
    selectItem('Task one')
    // `getByRole('button', ...)`: each row's own three-dot menu also has a
    // same-labeled item — see the analogous fix above.
    fireEvent.click(screen.getByRole('button', {name: 'action.markNotDone'}))

    await vi.waitFor(() => expect(reopenDraft).toHaveBeenCalledWith(expect.objectContaining({id: 'd1'})))
    expect(reopenTask).toHaveBeenCalledWith(expect.objectContaining({id: 't1'}))
  })

  it('snoozes a selection regardless of which source it came from, and marks it seen too', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})]}),
    }

    const {snoozes, dismissals} = renderList({reports, order: ['drafts', 'tasks']})

    selectItem('Draft one')
    selectItem('Task one')
    // `getByRole('button', ...)`: each row's own three-dot menu also has a
    // same-labeled "Snooze" item.
    fireEvent.click(screen.getByRole('button', {name: 'action.snooze'}))

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
    await vi.waitFor(() => expect(screen.queryByText('selection.count')).toBeNull())
  })

  it('keeps bulk delete available for both a single and a multi-row selection', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
        remove: vi.fn(),
      }),
    }

    renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    expect(screen.getByRole('button', {name: 'action.delete'})).toBeTruthy()

    selectItem('Draft two')
    expect(screen.getByRole('button', {name: 'action.delete'})).toBeTruthy()
  })

  it('offers "Ask AI" in a row\'s own menu rather than a persistent link, and shows the answer inline once asked', async () => {
    const assess = vi.fn().mockResolvedValue({message: 'Looks fine.'})
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})], assess}),
    }

    renderList({reports, order: ['drafts']})

    // No standing link/button under the row — only the menu item, hidden in
    // its own popover markup until opened (same reasoning as every other
    // menu action's `getByRole('button', ...)` disambiguation elsewhere in
    // this file).
    expect(screen.queryByRole('button', {name: 'assess.ask'})).toBeNull()

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'assess.ask'}))

    expect(assess).toHaveBeenCalledWith(expect.objectContaining({id: 'd1'}))
    await screen.findByText('Looks fine.')
  })

  it('hides the confirm button for a selection that has nothing real for it to do (todos)', () => {
    const reports = {
      todos: report('todos', 'Todos', {
        acknowledgable: false,
        open: [item('td1', {title: 'A todo'})],
      }),
    }

    renderList({reports, order: ['todos']})

    selectItem('A todo')
    expect(screen.queryByRole('button', {name: 'action.clear'})).toBeNull()
    expect(screen.queryByRole('button', {name: 'action.markDone'})).toBeNull()
    // Cancel is still there — the selection itself is still real, only
    // confirming it isn't.
    expect(screen.getByText('selection.count')).toBeTruthy()
  })

  it('selects and clears every row from the select-all header', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }

    renderList({reports, order: ['drafts']})

    const selectAll = screen.getByLabelText<HTMLInputElement>('selection.selectAll')
    fireEvent.click(selectAll)
    // No `resolve` on this source, so the action bar offers "Clear", not
    // "Mark as done" — see `SelectionActions.tsx`'s own doc comment.
    // `getByRole('button', ...)`: each row's own three-dot menu also has a
    // same-labeled item.
    expect(screen.getByRole('button', {name: 'action.clear'})).toBeTruthy()
    expect(selectAll).toHaveProperty('checked', true)

    fireEvent.click(selectAll)
    await vi.waitFor(() => expect(screen.queryByRole('button', {name: 'action.clear'})).toBeNull())
  })

  it('moves a dismissed row straight to Cleared, tagged as cleared by the editor', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }
    const dismissed: Dismissals = {
      state: withDismissal(EMPTY_DISMISSALS, 'drafts', 'd1'),
      dismiss: vi.fn(),
      restore: vi.fn(),
    }

    renderList({reports, order: ['drafts'], dismissals: dismissed})
    // Only the untouched draft is left in Open.
    expect(screen.getByText('Draft two')).toBeTruthy()
    expect(screen.queryByText('Draft one')).toBeNull()

    cleanup()

    renderList({reports, order: ['drafts'], dismissals: dismissed, view: 'cleared'})
    expect(screen.getByText('Draft one')).toBeTruthy()
    expect(screen.getByText(/cleared\.manual/)).toBeTruthy()
  })

  it('never treats a dismissal as a manual clear for a source that opted out of acknowledgable, even with one on record', () => {
    const reports = {
      todos: report('todos', 'Todos', {
        acknowledgable: false,
        open: [item('td1', {title: 'A todo'})],
      }),
    }
    const dismissed: Dismissals = {
      // A dismissal from before this source turned `acknowledgable` off —
      // routing must not trust it, the same way the write side no longer
      // offers a way to create or undo one.
      state: withDismissal(EMPTY_DISMISSALS, 'todos', 'td1'),
      dismiss: vi.fn(),
      restore: vi.fn(),
    }

    renderList({reports, order: ['todos'], dismissals: dismissed})
    expect(screen.getByText('A todo')).toBeTruthy()

    cleanup()

    renderList({reports, order: ['todos'], dismissals: dismissed, view: 'cleared'})
    expect(screen.queryByText('A todo')).toBeNull()
  })

  it('marks the select-all header indeterminate when only some rows are selected', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }

    renderList({reports, order: ['drafts']})

    selectItem('Draft one')

    const selectAll = screen.getByLabelText<HTMLInputElement>('selection.selectAll')
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(true)
  })

  it('brings a mistakenly-cleared selection back with undo', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts']})

    selectItem('Draft one')
    // No `resolve` on this source, so the button reads "Clear" — see
    // `SelectionActions.tsx`'s own doc comment on why the label depends on
    // `resolvableCount`. `getByRole('button', ...)`: the row's own three-dot
    // menu also has a same-labeled item.
    fireEvent.click(screen.getByRole('button', {name: 'action.clear'}))

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
    // `getByRole('button', ...)`: the row's own three-dot menu also has a
    // same-labeled "Snooze" item.
    fireEvent.click(screen.getByRole('button', {name: 'action.snooze'}))

    await vi.waitFor(() =>
      expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String)),
    )

    // A generous timeout, not the library default: this toast only appears
    // after `confirmSelection`'s own real `setTimeout(EXIT_ANIMATION_MS)`
    // resolves, and a slow, loaded test run can push that past the default
    // 1000ms window on its own, with nothing actually wrong.
    fireEvent.click(await screen.findByText('selection.undo', {}, {timeout: 5000}))
    expect(snoozes.wake).toHaveBeenCalledWith('drafts', 'd1')
    // Undo reverses the seen-marker snoozing also sets, not just the snooze itself.
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

describe("a row's own three-dot menu", () => {
  it('resolves a row for real via its menu, without selecting it first', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined)
    const reports = {
      tasks: report('tasks', 'Tasks', {open: [item('t1', {title: 'Task one'})], resolve}),
    }

    const {dismissals} = renderList({reports, order: ['tasks']})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.markDone'}))

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith(expect.objectContaining({id: 't1'})))
    expect(dismissals.dismiss).not.toHaveBeenCalled()
  })

  it('clears a row with no resolve via its menu, without selecting it first', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {dismissals} = renderList({reports, order: ['drafts']})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.clear'}))

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', 'd1'))
  })

  it('restores a manually-cleared row via its own menu in the Cleared view', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }
    const dismissed: Dismissals = {
      state: withDismissal(EMPTY_DISMISSALS, 'drafts', 'd1'),
      dismiss: vi.fn(),
      restore: vi.fn(),
    }

    renderList({reports, order: ['drafts'], dismissals: dismissed, view: 'cleared'})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.markNotDone'}))

    await vi.waitFor(() => expect(dismissed.restore).toHaveBeenCalledWith('drafts', 'd1'))
  })

  it('snoozes a single row via its menu', async () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }

    const {snoozes} = renderList({reports, order: ['drafts']})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.snooze'}))

    await vi.waitFor(() =>
      expect(snoozes.snooze).toHaveBeenCalledWith('drafts', 'd1', expect.any(String)),
    )
  })

  it('reopens a single cleared row via its menu', async () => {
    const reopen = vi.fn().mockResolvedValue(undefined)
    const reports = {
      drafts: report('drafts', 'Drafts', {cleared: [item('d1', {title: 'Draft one'})], reopen}),
    }

    renderList({reports, order: ['drafts'], view: 'cleared'})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.markNotDone'}))

    await vi.waitFor(() => expect(reopen).toHaveBeenCalledWith(expect.objectContaining({id: 'd1'})))
  })

  it('wakes a single snoozed row via its menu', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {snoozed: [item('d1', {title: 'Draft one'})]}),
    }

    const {snoozes} = renderList({reports, order: ['drafts'], view: 'snoozed'})

    openRowMenu()
    fireEvent.click(screen.getByRole('menuitem', {name: 'action.wakeNow'}))

    expect(snoozes.wake).toHaveBeenCalledWith('drafts', 'd1')
  })
})

describe('AskInbox integration', () => {
  function checkboxFor(title: string): HTMLInputElement {
    const labelId = screen.getByText(title).closest('[id]')?.id
    const checkbox = document.querySelector<HTMLInputElement>(`input[aria-labelledby="${labelId}"]`)
    if (!checkbox) throw new Error(`no checkbox labelled by "${title}"`)
    return checkbox
  }

  function ask(question: string) {
    fireEvent.change(screen.getByPlaceholderText('ask.placeholder'), {target: {value: question}})
    fireEvent.click(screen.getByRole('button', {name: 'ask.submit'}))
  }

  it('does not render the input when ask is off', () => {
    const reports = {drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]})}
    renderList({ask: false, reports, order: ['drafts']})

    expect(screen.queryByPlaceholderText('ask.placeholder')).toBeNull()
  })

  it('does not render the input outside the Open view, even with ask on', () => {
    const reports = {
      drafts: report('drafts', 'Drafts', {cleared: [item('d1', {title: 'Draft one'})]}),
    }
    renderList({ask: true, reports, order: ['drafts'], view: 'cleared'})

    expect(screen.queryByPlaceholderText('ask.placeholder')).toBeNull()
  })

  it('selects exactly the rows a mocked answer names, ignoring an invented key', async () => {
    promptJsonMock.mockResolvedValue({keys: ['drafts d1', 'drafts nonexistent'], reason: 'Both about launch.'})

    const reports = {
      drafts: report('drafts', 'Drafts', {
        open: [item('d1', {title: 'Draft one'}), item('d2', {title: 'Draft two'})],
      }),
    }
    renderList({ask: true, reports, order: ['drafts']})

    ask('things about the launch')

    await vi.waitFor(() => expect(checkboxFor('Draft one').checked).toBe(true))
    expect(checkboxFor('Draft two').checked).toBe(false)
    expect(await screen.findByText('Both about launch.')).toBeTruthy()
  })

  it('selects nothing and shows the reason when the answer matches nothing', async () => {
    promptJsonMock.mockResolvedValue({keys: [], reason: 'Nothing here is about pricing.'})

    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})]}),
    }
    renderList({ask: true, reports, order: ['drafts']})

    ask('anything about pricing')

    expect(await screen.findByText('Nothing here is about pricing.')).toBeTruthy()
    expect(checkboxFor('Draft one').checked).toBe(false)
  })

  it('never calls any source\'s resolve as a result of asking a question', async () => {
    promptJsonMock.mockResolvedValue({keys: ['drafts d1'], reason: 'Matches.'})
    const resolve = vi.fn()

    const reports = {
      drafts: report('drafts', 'Drafts', {open: [item('d1', {title: 'Draft one'})], resolve}),
    }
    renderList({ask: true, reports, order: ['drafts']})

    ask('anything')

    await vi.waitFor(() => expect(checkboxFor('Draft one').checked).toBe(true))
    expect(resolve).not.toHaveBeenCalled()
  })
})
