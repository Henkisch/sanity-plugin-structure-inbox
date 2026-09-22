import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {ToastProvider} from '@sanity/ui/toast'
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {StrictMode, type ReactElement} from 'react'
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

// `render`'s own `rerender` replaces the whole tree it was given, not just
// the row — so a re-render that only swaps props must still pass the same
// `ThemeProvider`/`ToastProvider` wrapper `renderRow` used, or it tears that
// context down along with the row itself.
function rerenderRow(rerender: (ui: ReactElement) => void, ui: ReactElement) {
  rerender(
    <ThemeProvider theme={theme}>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  )
}

// `StrictMode` only for the one test that needs it: React double-invokes a
// `setState` updater function under `StrictMode` specifically to catch an
// impure one — every other test in this file renders without it, since
// doubling *their* own mocked callbacks (`onAssess`/`onProposeFix`) would
// break assertions that have nothing to do with this.
function renderRowStrict(ui: ReactElement) {
  return render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </StrictMode>,
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

  it('names the actual verb at the top of the picker, when the source provides one', () => {
    renderRow(
      <InboxRow
        assignableUsers={[{id: 'user-1', label: 'Ada'}]}
        item={item({assignee: {id: 'henrik', label: 'Henrik Larsson'}})}
        onReassign={vi.fn()}
        onSelectedChange={vi.fn()}
        reassignVerb="Hand off to…"
        selected={false}
      />,
    )

    fireEvent.click(screen.getByTitle('Henrik Larsson'))

    expect(screen.getByText('Hand off to…')).toBeTruthy()
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

      const message = await screen.findByText('Looks ready to publish.')
      expect(message).toBeTruthy()
      // Regression: a toneless success must stay plain text, not get pulled
      // into the failure path's new critical-toned `Card` treatment. (The
      // row itself renders inside its own default-toned `Card` — see
      // `HoverableCard` — so this checks specifically for a critical tone,
      // not for the absence of any `Card` ancestor at all.)
      expect(message.closest('[data-tone="critical"]')).toBeNull()
    })

    it('renders assess.unavailable, not assess.error, when the model answered but not usably', async () => {
      const onAssess = vi.fn().mockRejectedValue(new AssessmentUnavailableError())

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      expect(await screen.findByText('assess.unavailable')).toBeTruthy()
      expect(screen.queryByText('assess.error')).toBeNull()
    })

    it('renders assess.error inside a critical-toned card, not plain text', async () => {
      const onAssess = vi.fn().mockRejectedValue(new Error('network down'))

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)
      askAi()

      const message = await screen.findByText('assess.error')
      expect(screen.queryByText('assess.unavailable')).toBeNull()
      const card = message.closest('[data-tone="critical"]')
      expect(card).not.toBeNull()
      expect(card?.getAttribute('data-ui')).toBe('Card')
    })

    // Plan 044: unlike `handleSuggestTodos`/etc in `Inbox.tsx` (whose trigger
    // `MenuItem` already has a `disabled={status === 'loading'}` prop from
    // Plan 032), `handleAssess`'s own trigger here has no such prop at all —
    // so, before this plan, a second real, separately-timed click on
    // "assess.ask" while the first request was still in flight called
    // `onAssess` a second time, spending a second real AI credit for what
    // reads as one click. Two *separate* `fireEvent.click` calls (not both
    // batched inside one `act()`, the technique the "keeps the later
    // request's result" style tests use elsewhere in this codebase) is the
    // realistic shape of that bug: each click is individually flushed, so
    // the second one lands only after `assessment.status` has already
    // committed to `'loading'` from the first.
    it('calls onAssess only once when its trigger is clicked twice in a row', async () => {
      const onAssess = vi.fn().mockResolvedValue({message: 'Looks ready to publish.'})

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)

      fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
      fireEvent.click(screen.getByRole('menuitem', {name: 'assess.ask'}))
      fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
      fireEvent.click(screen.getByRole('menuitem', {hidden: true, name: 'assess.ask'}))

      expect(await screen.findByText('Looks ready to publish.')).toBeTruthy()
      expect(onAssess).toHaveBeenCalledTimes(1)
    })

    // The tighter race: both clicks dispatched inside one `act()` call, the
    // same technique Plan 032's own test uses for the Inbox.tsx menu (see
    // `Inbox.test.tsx`'s `handleSuggestTodos` describe block). A plain
    // `assessment.status === 'loading'` check alone does *not* close this
    // one — both clicks run before React commits the first one's
    // `setAssessment({status: 'loading'})`, so both read the same stale,
    // pre-loading state and both would fire. `assessInFlightRef` (a plain
    // ref, mutated synchronously, not through `setState`) is what actually
    // closes it here.
    it('calls onAssess only once even when both clicks land in the same React batch', async () => {
      let resolveOnAssess!: (value: {message: string}) => void
      const onAssess = vi.fn().mockImplementation(() => new Promise((resolve) => (resolveOnAssess = resolve)))

      renderRow(<InboxRow item={item()} onAssess={onAssess} onSelectedChange={vi.fn()} selected={false} />)

      fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
      const assessItem = screen.getByRole('menuitem', {name: 'assess.ask'})

      act(() => {
        fireEvent.click(assessItem)
        fireEvent.click(assessItem)
      })

      expect(onAssess).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveOnAssess({message: 'Looks ready to publish.'})
        await Promise.resolve()
      })
    })

    // Plan 070: `initialAssessment` used to be read exactly once, in a lazy
    // `useState` initializer that only ever runs at mount. The assessments
    // store loads asynchronously, so on a cold pane a row routinely mounts
    // *before* its cached document resolves — the initializer saw `undefined`
    // and the value that showed up a moment later was silently thrown away,
    // so the editor paid for an "Ask AI" click the cache exists to avoid.
    // Before this plan's fix, this test failed: the row stayed idle forever.
    it('adopts a cached assessment that resolves after the row has already mounted', () => {
      const onAssess = vi.fn()

      const {rerender} = renderRow(
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.queryByText('Looks ready to publish.')).toBeNull()

      rerenderRow(
        rerender,
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          initialAssessment={{message: 'Looks ready to publish.'}}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.getByText('Looks ready to publish.')).toBeTruthy()
    })

    // The adoption above must never clobber a request that is genuinely in
    // flight, or a result that just landed live — `assessInFlightRef` (the
    // same ref that already closes the double-click race above) is what
    // this plan's sync reuses to tell the two apart.
    it('does not let a late cache arrival stomp an assess request that is still loading', async () => {
      let resolveOnAssess!: (value: {message: string}) => void
      const onAssess = vi.fn().mockImplementation(() => new Promise((resolve) => (resolveOnAssess = resolve)))

      const {rerender} = renderRow(
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      askAi()
      expect(await screen.findByText('assess.loading')).toBeTruthy()

      // A cache document for this same version resolves while the live
      // request is still in flight.
      rerenderRow(
        rerender,
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          initialAssessment={{message: 'Stale cached answer.'}}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.getByText('assess.loading')).toBeTruthy()
      expect(screen.queryByText('Stale cached answer.')).toBeNull()

      await act(async () => {
        resolveOnAssess({message: 'Live answer.'})
        await Promise.resolve()
      })

      expect(await screen.findByText('Live answer.')).toBeTruthy()
    })

    // This is the guarantee `src/store/assessments.ts:66-77` promises on the
    // cache-read side — that a row must never show a confidently-wrong
    // verdict about a since-edited draft. Before this plan's fix, the row's
    // local `assessment` state survived a `changedAt` change untouched (its
    // key, `mergeItems.ts`'s `${sourceName} ${item.id}`, does not include
    // `changedAt`, so the row never remounts), and this test failed: the old
    // verdict stayed on screen.
    it('drops a cached assessment once the document it was about has changed', () => {
      const onAssess = vi.fn()

      const {rerender} = renderRow(
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          initialAssessment={{message: 'Looks ready to publish.'}}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.getByText('Looks ready to publish.')).toBeTruthy()

      // The document was edited: `changedAt` moves, and `assessments.read()`
      // (invalidated on exactly that field) now returns nothing.
      rerenderRow(
        rerender,
        <InboxRow
          item={item({changedAt: 'v2'})}
          onAssess={onAssess}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.queryByText('Looks ready to publish.')).toBeNull()
    })

    // The cache write for a just-returned live result may not have reached
    // `MergedList` yet, so `initialAssessment` can legitimately recompute as
    // `undefined` on the very next render even though nothing about the
    // document changed. That must not be read as an invalidation.
    it('keeps a live result on a re-render that recomputes initialAssessment as undefined', async () => {
      const onAssess = vi.fn().mockResolvedValue({message: 'Live answer.'})

      const {rerender} = renderRow(
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      askAi()
      expect(await screen.findByText('Live answer.')).toBeTruthy()

      rerenderRow(
        rerender,
        <InboxRow
          item={item({changedAt: 'v1'})}
          onAssess={onAssess}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )

      expect(screen.getByText('Live answer.')).toBeTruthy()
    })
  })

  describe('fix', () => {
    function askForFix() {
      fireEvent.click(screen.getByRole('button', {name: 'row.menu'}))
      fireEvent.click(screen.getByRole('menuitem', {name: 'fix.ask'}))
    }

    it('renders fix.error inside a critical-toned card, not plain text', async () => {
      const onProposeFix = vi.fn().mockRejectedValue(new Error('network down'))

      renderRow(
        <InboxRow
          item={item({fixable: true})}
          onProposeFix={onProposeFix}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )
      askForFix()

      const message = await screen.findByText('fix.error')
      const card = message.closest('[data-tone="critical"]')
      expect(card).not.toBeNull()
      expect(card?.getAttribute('data-ui')).toBe('Card')
    })

    it('applies a proposed fix exactly once under StrictMode, instead of once per invocation of an impure setFix updater', async () => {
      // Regression for the exact bug class `Inbox.tsx`'s own
      // `handleAddSuggestion` was already fixed for once: React invokes a
      // `setState` updater function twice under `StrictMode` specifically
      // to catch one that isn't pure. `proposal.apply()` is a real,
      // one-shot mutation — if it lived inside the `setFix` updater
      // (instead of the handler body), StrictMode's double-invocation
      // would call it twice for a single click, applying the fix twice.
      let resolveApply!: () => void
      const apply = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveApply = resolve
          }),
      )
      const onProposeFix = vi.fn().mockResolvedValue({summary: 'Replace with "Jane Doe"', apply})

      renderRowStrict(
        <InboxRow
          item={item({fixable: true})}
          onProposeFix={onProposeFix}
          onSelectedChange={vi.fn()}
          selected={false}
        />,
      )
      askForFix()
      await screen.findByText('Replace with "Jane Doe"')

      fireEvent.click(screen.getByRole('button', {name: 'fix.apply'}))

      expect(apply).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveApply()
        await Promise.resolve()
      })
      expect(await screen.findByText('fix.applied')).toBeTruthy()
    })
  })
})
