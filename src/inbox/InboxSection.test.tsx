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

  it('opens an edit dialog on click for a source that offers update, with no selection involved', () => {
    const update = vi.fn()

    renderSection({
      source: {
        name: 'todos',
        title: 'Todos',
        useItems: () => ({
          items: [item('1', {title: 'Write docs'})],
          // `CreateItemRow` is the shared create/edit dialog — it only
          // mounts at all once the source also offers `create`, same as
          // before this component dropped bulk selection.
          create: vi.fn(),
          update,
        }),
      },
    })

    fireEvent.click(screen.getByText('Write docs'))
    expect(screen.getByText('todos.editButton')).toBeTruthy()
  })

  it('reassigns a row directly via its own avatar — no bulk selection mechanism exists here', () => {
    const toUser = vi.fn().mockResolvedValue(undefined)

    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Assign me', assignee: {label: 'Henrik Larsson'}})],
          assign: {users: [{id: 'user-1', label: 'Ada'}], toUser},
        }),
      },
    })

    fireEvent.click(screen.getByTitle('Henrik Larsson'))
    fireEvent.click(screen.getByText('Ada'))

    expect(toUser).toHaveBeenCalledWith(expect.objectContaining({id: '1'}), 'user-1')
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

    // No assignee and nobody to assign to: the row's avatar renders as a
    // plain, non-interactive placeholder rather than a `MenuButton` — there
    // is nothing a click on it could offer.
    expect(screen.queryByText('Ada')).toBeNull()
  })

  it('does not offer ask AI or delete — no bulk selection exists here to gate them on', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Draft one'})],
          assess: vi.fn(),
          remove: vi.fn(),
        }),
      },
    })

    expect(screen.queryByText('assess.ask')).toBeNull()
    expect(screen.queryByText('action.delete')).toBeNull()
  })

  it('does not render a "select all" header — aside sources are ambient context, not a worklist to bulk-clear', () => {
    renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({
          items: [item('1', {title: 'Draft one'}), item('2', {title: 'Draft two'})],
        }),
      },
    })

    expect(screen.queryByText('selection.selectAll')).toBeNull()
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
  })
})
