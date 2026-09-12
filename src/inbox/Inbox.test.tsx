import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {render, screen} from '@testing-library/react'
import {describe, expect, it, vi} from 'vitest'

import {EMPTY_DISMISSALS} from '../store/dismissals'
import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Dismissals} from '../store/useDismissals'
import {type Snoozes} from '../store/useSnoozes'
import {BoundedSection} from './Inbox'
import {type InboxSource} from './types'

/**
 * `Inbox` itself calls `useDismissals`, which calls `useClient` and needs a
 * full Studio source context to mount — more than a unit test for the error
 * boundary should have to carry. `BoundedSection` is the piece that actually
 * wires the boundary around `InboxSection`, and it only needs `dismissals` as
 * a plain prop, so it is rendered directly here instead, per the plan's
 * fallback: the smallest thing that proves a throwing source is contained.
 */
const dismissals: Dismissals = {
  state: EMPTY_DISMISSALS,
  dismiss: () => {},
  restore: () => {},
}

const snoozes: Snoozes = {
  state: EMPTY_SNOOZES,
  snooze: () => {},
  wake: () => {},
}

const theme = buildTheme()

function renderSections(sources: InboxSource[]) {
  return render(
    <ThemeProvider theme={theme}>
      {sources.map((source) => (
        <BoundedSection
          dismissals={dismissals}
          key={source.name}
          onCount={() => {}}
          snoozes={snoozes}
          source={source}
          view="open"
        />
      ))}
    </ThemeProvider>,
  )
}

function workingSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => ({items: []}),
  }
}

function throwingSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => {
      throw new Error(`${name} blew up`)
    },
  }
}

function reportedErrorSource(name: string, title: string): InboxSource {
  return {
    name,
    title,
    useItems: () => ({items: [], error: new Error(`${name} reported`)}),
  }
}

describe('BoundedSection', () => {
  it('contains a throwing source to its own card, leaving its sibling rendered', () => {
    // The boundary logs the caught error via console.error; that is expected
    // noise from this test, not a failure to surface.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderSections([throwingSource('bad', 'Bad Source'), workingSource('good', 'Good Source')])

    // The throwing source gets an error card of its own, not a blank pane.
    expect(screen.getByText('Bad Source')).toBeTruthy()
    expect(screen.getByText('bad blew up')).toBeTruthy()

    // Its sibling is unaffected — this is the regression: before the fix, the
    // throw unwinds past both sections, and the whole pane crashes.
    expect(screen.getByText('Good Source')).toBeTruthy()
  })

  it('still renders the existing error card for a source that reports an error', () => {
    renderSections([reportedErrorSource('flaky', 'Flaky Source')])

    expect(screen.getByText('Flaky Source')).toBeTruthy()
    expect(screen.getByText('flaky reported')).toBeTruthy()
  })
})
