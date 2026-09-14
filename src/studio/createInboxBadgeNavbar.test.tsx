import {cleanup, screen} from '@testing-library/react'
import {type NavbarProps} from 'sanity'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {renderWithTheme} from '../test/renderWithTheme'
import {createInboxBadgeNavbar} from './createInboxBadgeNavbar'

// Hoisted, so the mock factory below can close over it before `vi.mock` is
// hoisted above this file's own imports — the same pattern
// `useDismissals.test.tsx` uses for the equivalent `sanity` mock.
const {useInboxOpenCountMock} = vi.hoisted(() => ({useInboxOpenCountMock: vi.fn()}))

vi.mock('./inboxCountLayout', () => ({useInboxOpenCount: useInboxOpenCountMock}))

// `vitest.config.ts` sets `globals: false`, so `@testing-library/react`'s
// framework-detected auto-cleanup never registers — see `InboxSection.test.tsx`'s
// identical comment.
afterEach(() => {
  cleanup()
  useInboxOpenCountMock.mockReset()
})

function fakeNavbarProps() {
  const renderDefault = vi.fn(() => <div data-testid="default-navbar" />)
  return {renderDefault, props: {renderDefault} as unknown as NavbarProps}
}

describe('createInboxBadgeNavbar', () => {
  it('renders nothing extra when useInboxOpenCount() returns null', () => {
    useInboxOpenCountMock.mockReturnValue(null)
    const InboxBadgeNavbar = createInboxBadgeNavbar()
    const {props} = fakeNavbarProps()

    renderWithTheme(<InboxBadgeNavbar {...props} />)

    expect(screen.getByTestId('default-navbar')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing extra when useInboxOpenCount() returns 0', () => {
    useInboxOpenCountMock.mockReturnValue(0)
    const InboxBadgeNavbar = createInboxBadgeNavbar()
    const {props} = fakeNavbarProps()

    renderWithTheme(<InboxBadgeNavbar {...props} />)

    expect(screen.getByTestId('default-navbar')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the badge with the right count and an accessible label', () => {
    useInboxOpenCountMock.mockReturnValue(3)
    const InboxBadgeNavbar = createInboxBadgeNavbar()
    const {props} = fakeNavbarProps()

    renderWithTheme(<InboxBadgeNavbar {...props} />)

    const badge = screen.getByRole('status')
    expect(badge.textContent).toContain('3')
    expect(badge.getAttribute('aria-label')).toBe('3 things waiting on you')
  })

  it('always calls renderDefault, regardless of the count', () => {
    useInboxOpenCountMock.mockReturnValue(3)
    const InboxBadgeNavbar = createInboxBadgeNavbar()
    const {props, renderDefault} = fakeNavbarProps()

    renderWithTheme(<InboxBadgeNavbar {...props} />)

    expect(renderDefault).toHaveBeenCalledTimes(1)
  })
})
