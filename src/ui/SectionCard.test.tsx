import {cleanup, screen} from '@testing-library/react'
import {afterEach, describe, expect, it} from 'vitest'

import {renderWithTheme} from '../test/renderWithTheme'
import {SectionCard} from './SectionCard'

// `vitest.config.ts` sets `globals: false`, so `@testing-library/react`'s
// framework-detected auto-cleanup never registers — without this, one test's
// DOM stays mounted for the next.
afterEach(cleanup)

describe('SectionCard', () => {
  it('renders its error state with the same critical tone every other error in this pane uses', () => {
    renderWithTheme(
      <SectionCard error={new Error('Could not reach the source.')} title="Releases">
        <div>child</div>
      </SectionCard>,
    )

    // The rendered `Card` sets `data-tone` on its own DOM node (Sanity UI's
    // theme-color mechanism) — walk up from the error message to the
    // nearest `Card` ancestor and assert on that, the same way
    // `MergedList.tsx`'s own error card already reads.
    const message = screen.getByText('Could not reach the source.')
    const card = message.closest('[data-ui="Card"]')

    expect(card).not.toBeNull()
    expect(card?.getAttribute('data-tone')).toBe('critical')
  })
})
