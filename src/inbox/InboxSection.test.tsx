import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {type Dismissals} from '../store/useDismissals'
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

function renderSection(props: {
  source: InboxSource
  dismissals?: Dismissals
  view?: 'open' | 'done'
}) {
  const dismissals = props.dismissals ?? fakeDismissals()

  renderWithTheme(
    <InboxSection
      dismissals={dismissals}
      onCount={() => {}}
      source={props.source}
      view={props.view ?? 'open'}
    />,
  )

  return dismissals
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

    const dismissals = renderSection({
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

  it('dismisses locally, without calling resolve, when the source has none', () => {
    const dismissals = renderSection({
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1'), item('2')]}),
      },
    })

    selectItem('Item 1')
    selectItem('Item 2')
    fireEvent.click(markDoneButton())

    expect(dismissals.dismiss).toHaveBeenCalledTimes(2)
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', '1')
    expect(dismissals.dismiss).toHaveBeenCalledWith('drafts', '2')
  })

  it('restores rather than dismisses on the done tab, and never calls dismiss', () => {
    const dismissals = renderSection({
      view: 'done',
      source: {
        name: 'drafts',
        title: 'Drafts',
        useItems: () => ({items: [item('1'), item('2')]}),
      },
      dismissals: {
        state: {version: 1, dismissed: {drafts: {'1': '2026-01-01T00:00:00.000Z', '2': '2026-01-01T00:00:00.000Z'}}},
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
})
