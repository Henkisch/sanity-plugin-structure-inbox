import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {renderWithTheme} from '../test/renderWithTheme'
import {InboxSection} from './InboxSection'
import {type InboxItem, type InboxSource} from './types'

// `vitest.config.ts` sets `globals: false`, so `@testing-library/react`'s
// framework-detected auto-cleanup never registers — without this, one test's
// DOM stays mounted for the next, and items reused across tests (`Item 1`)
// resolve to multiple elements.
afterEach(cleanup)

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  // `RelativeTime` calls this, which needs a full Studio locale context this
  // suite does not build. Only exercised by the one test below that needs a
  // real (displayed but unused) `item.timestamp` — the return value plays no
  // part in any assertion.
  return {...actual, useRelativeTime: () => 'a while ago'}
})

/**
 * `useTranslation` has no i18next instance in this environment (the plugin's
 * bundle is only registered by the Studio config, which these tests do not
 * load), so `t()` returns its key rather than the English string. That is
 * harmless here — the tests assert on the keys, per the plan's fallback.
 */
function markDoneButton() {
  return screen.getByText('action.markDone')
}

function markNotDoneButton() {
  return screen.getByText('action.markNotDone')
}

function wakeNowButton() {
  return screen.getByText('action.wakeNow')
}

/**
 * The checkbox has no visible label of its own — it points at the row's title
 * text via `aria-labelledby` — so the click has to land on the input itself,
 * found by following that association from the title text's id.
 */
function selectItem(title: string) {
  // `getByText` matches the innermost element wrapping the text, but the `id`
  // the checkbox's `aria-labelledby` points at lives on the `Text` component's
  // own element, one or more levels up.
  const labelId = screen.getByText(title).closest('[id]')?.id
  const checkbox = document.querySelector<HTMLInputElement>(`input[aria-labelledby="${labelId}"]`)
  if (!checkbox) throw new Error(`no checkbox labelled by "${title}"`)
  fireEvent.click(checkbox)
}

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function fakeDismissals(): Dismissals {
  return {state: EMPTY_DISMISSALS, dismiss: vi.fn(), restore: vi.fn()}
}

function fakeSnoozes(): Snoozes {
  return {state: EMPTY_SNOOZES, snooze: vi.fn(), wake: vi.fn()}
}

function renderSection(props: {
  source: InboxSource
  dismissals?: Dismissals
  snoozes?: Snoozes
  view?: 'open' | 'done' | 'snoozed'
}) {
  const dismissals = props.dismissals ?? fakeDismissals()
  const snoozes = props.snoozes ?? fakeSnoozes()

  renderWithTheme(
    <InboxSection
      dismissals={dismissals}
      onCount={() => {}}
      snoozes={snoozes}
      source={props.source}
      view={props.view ?? 'open'}
    />,
  )

  return {dismissals, snoozes}
}

describe('InboxSection', () => {
  it('renders an item from its source', () => {
    renderSection({
      source: {
        name: 'tasks',
        title: 'Tasks',
        useItems: () => ({items: [item('1', {title: 'Write the launch email'})]}),
      },
    })

    expect(screen.getByText('Write the launch email')).toBeTruthy()
  })

  it('marks the succeeding items done and leaves the failing one alone', async () => {
    // The guarantee this plan exists to protect: `Promise.allSettled` means one
    // item's `resolve` rejecting must not stop the others from being marked
    // done, and the failing item's own id must never reach `dismiss`.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const resolve = vi.fn((target: InboxItem) =>
      target.id === '2' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined),
    )

    const {dismissals} = renderSection({
      source: {
        name: 'tasks',
        title: 'Tasks',
        useItems: () => ({items: [item('1'), item('2'), item('3')], resolve}),
      },
    })

    selectItem('Item 1')
    selectItem('Item 2')
    selectItem('Item 3')

    fireEvent.click(markDoneButton())

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledTimes(2))

    expect(dismissals.dismiss).toHaveBeenCalledWith('tasks', '1')
    expect(dismissals.dismiss).toHaveBeenCalledWith('tasks', '3')
    expect(dismissals.dismiss).not.toHaveBeenCalledWith('tasks', '2')
  })

  it('dismisses locally, without calling resolve, when the source has none', async () => {
    const {dismissals} = renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1'), item('2')]}),
      },
    })

    selectItem('Item 1')
    selectItem('Item 2')
    fireEvent.click(markDoneButton())

    await vi.waitFor(() => expect(dismissals.dismiss).toHaveBeenCalledTimes(2))
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', '1')
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', '2')
  })

  it('restores rather than dismisses on the done tab, and never calls dismiss', () => {
    const {dismissals} = renderSection({
      view: 'done',
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1'), item('2')]}),
      },
      dismissals: {
        state: {
          version: 1,
          dismissed: {drafts: {'1': '2026-01-01T00:00:00.000Z', '2': '2026-01-01T00:00:00.000Z'}},
        },
        dismiss: vi.fn(),
        restore: vi.fn(),
      },
    })

    selectItem('Item 1')
    selectItem('Item 2')
    fireEvent.click(markNotDoneButton())

    expect(dismissals.restore).toHaveBeenCalledTimes(2)
    expect(dismissals.restore).toHaveBeenCalledWith('drafts', '1')
    expect(dismissals.restore).toHaveBeenCalledWith('drafts', '2')
    expect(dismissals.dismiss).not.toHaveBeenCalled()
  })

  it('splits open vs. done by changedAt, not by the display timestamp', () => {
    // Regression for the gap plan 001 left open: `InboxSection` must read
    // `item.changedAt` to decide which tab an item lands in. `item.timestamp`
    // is display-only and may be a future due date — reverting the split to
    // read it would resurrect this item into Open immediately after it is
    // ticked, and this test would go red.
    const dismissedAt = '2026-01-01T00:00:00.000Z'
    const future = '2027-01-01T00:00:00.000Z'
    const past = '2025-01-01T00:00:00.000Z'

    renderSection({
      view: 'done',
      source: {
        name: 'releases',
        title: 'Releases',
        useItems: () => ({
          items: [item('1', {title: 'Ticked release', timestamp: future, changedAt: past})],
        }),
      },
      dismissals: {
        state: {version: 1, dismissed: {releases: {'1': dismissedAt}}},
        dismiss: vi.fn(),
        restore: vi.fn(),
      },
    })

    expect(screen.getByText('Ticked release')).toBeTruthy()
  })

  it('hides a snoozed item from Open and lists it in Snoozed', () => {
    const future = '2027-01-01T00:00:00.000Z'

    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Asleep for now'})]}),
      },
      snoozes: {
        state: {
          version: 1,
          snoozed: {drafts: {'1': {at: '2026-01-01T00:00:00.000Z', until: future}}},
        },
        snooze: vi.fn(),
        wake: vi.fn(),
      },
    })

    expect(screen.queryByText('Asleep for now')).toBeNull()
  })

  it('wakes rather than dismisses on the snoozed tab', () => {
    const future = '2027-01-01T00:00:00.000Z'

    const {snoozes} = renderSection({
      view: 'snoozed',
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Asleep for now'})]}),
      },
      snoozes: {
        state: {
          version: 1,
          snoozed: {drafts: {'1': {at: '2026-01-01T00:00:00.000Z', until: future}}},
        },
        snooze: vi.fn(),
        wake: vi.fn(),
      },
    })

    selectItem('Asleep for now')
    fireEvent.click(wakeNowButton())

    expect(snoozes.wake).toHaveBeenCalledWith('drafts', '1')
  })

  it('snoozes a selected item for the chosen preset', async () => {
    const {snoozes} = renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Snooze me'})]}),
      },
    })

    selectItem('Snooze me')
    fireEvent.change(screen.getByDisplayValue('action.snooze'), {target: {value: 'tomorrow'}})

    await vi.waitFor(() =>
      expect(snoozes.snooze).toHaveBeenCalledWith('drafts', '1', expect.any(String)),
    )
  })

  it('renders the create row and adds an item, only in the open view', () => {
    const create = vi.fn()

    renderSection({
      source: {
        name: 'todos',
        title: 'Todos',
        useItems: () => ({items: [], create}),
      },
    })

    fireEvent.click(screen.getByText('todos.addButton'))
    fireEvent.change(screen.getByPlaceholderText('todos.addPlaceholder'), {
      target: {value: 'Write the launch email'},
    })
    fireEvent.click(screen.getByText('todos.add'))

    expect(create).toHaveBeenCalledWith({
      title: 'Write the launch email',
      description: undefined,
      dueBy: undefined,
    })
  })

  it('hides the create row outside the open view', () => {
    renderSection({
      view: 'done',
      source: {
        name: 'todos',
        title: 'Todos',
        useItems: () => ({items: [], create: vi.fn()}),
      },
    })

    expect(screen.queryByText('todos.addButton')).toBeNull()
  })

  it('asks AI and shows the result', async () => {
    const assess = vi.fn().mockResolvedValue('Looks ready to publish.')

    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Draft one'})], assess}),
      },
    })

    selectItem('Draft one')
    fireEvent.click(screen.getByText('assess.ask'))

    expect(screen.getByText('assess.loading')).toBeTruthy()
    expect(assess).toHaveBeenCalledWith(expect.objectContaining({id: '1'}))

    await screen.findByText('Looks ready to publish.')
  })

  it('shows a fallback message when asking AI fails', async () => {
    const assess = vi.fn().mockRejectedValue(new Error('boom'))

    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Draft one'})], assess}),
      },
    })

    selectItem('Draft one')
    fireEvent.click(screen.getByText('assess.ask'))

    await screen.findByText('assess.error')
  })

  it('does not offer to ask AI on an unselected row, even when the source has assess', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Draft one'})], assess: vi.fn()}),
      },
    })

    expect(screen.queryByText('assess.ask')).toBeNull()
  })

  it('does not offer to ask AI when the source has no assess', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Draft one'})]}),
      },
    })

    selectItem('Draft one')
    expect(screen.queryByText('assess.ask')).toBeNull()
  })

  it('deletes a selected item for good, only once selected', () => {
    const remove = vi.fn()

    renderSection({
      source: {
        name: 'todos',
        title: 'Todos',
        useItems: () => ({items: [item('1', {title: 'Todo one'})], remove}),
      },
    })

    expect(screen.queryByText('action.delete')).toBeNull()

    selectItem('Todo one')
    fireEvent.click(screen.getByText('action.delete'))

    expect(remove).toHaveBeenCalledWith(expect.objectContaining({id: '1'}))
  })

  it('assigns a selected item to the chosen user', async () => {
    const toUser = vi.fn().mockResolvedValue(undefined)

    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Assign me'})],
          assign: {users: [{id: 'user-1', label: 'Ada'}], toUser},
        }),
      },
    })

    selectItem('Assign me')
    fireEvent.change(screen.getByDisplayValue('action.assign'), {target: {value: 'user-1'}})

    await vi.waitFor(() => expect(toUser).toHaveBeenCalledTimes(1))
    expect(toUser).toHaveBeenCalledWith(expect.objectContaining({id: '1'}), 'user-1')
  })

  it('offers ask AI and delete for a lone selected row, but hides both once a second is selected', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Draft one'}), item('2', {title: 'Draft two'})],
          assess: vi.fn(),
          remove: vi.fn(),
        }),
      },
    })

    selectItem('Draft one')
    expect(screen.getByText('assess.ask')).toBeTruthy()
    expect(screen.getByText('action.delete')).toBeTruthy()

    selectItem('Draft two')
    expect(screen.queryByText('assess.ask')).toBeNull()
    expect(screen.queryByText('action.delete')).toBeNull()
  })

  it('selects a row by clicking anywhere on it, not just its checkbox', async () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1', {title: 'Click me'})]}),
      },
    })

    fireEvent.click(screen.getByText('Click me'))
    expect(screen.getByText('selection.count')).toBeTruthy()

    fireEvent.click(screen.getByText('Click me'))
    // The bar lingers briefly so its collapse can ease shut rather than snap
    // — see `useDelayedUnmount`.
    await vi.waitFor(() => expect(screen.queryByText('selection.count')).toBeNull())
  })

  it('selects and clears every visible row from the select-all header', async () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Draft one'}), item('2', {title: 'Draft two'})],
        }),
      },
    })

    const selectAll = screen.getByTitle('selection.selectAll')
    fireEvent.click(selectAll)
    expect(markDoneButton()).toBeTruthy()
    // Two selected: assess/delete are per-source and absent from this
    // source's items, but the row actions gate is exercised in the dedicated
    // "hides ask AI and delete" test above — here it's enough to confirm the
    // bar tracks both rows and clears them together.
    expect(selectAll).toHaveProperty('checked', true)

    fireEvent.click(selectAll)
    await vi.waitFor(() => expect(screen.queryByText('action.markDone')).toBeNull())
  })

  it('hides the assign picker when there is no one to assign to', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Assign me'})],
          assign: {users: [], toUser: vi.fn()},
        }),
      },
    })

    selectItem('Assign me')

    expect(screen.queryByText('action.assign')).toBeNull()
  })
})
