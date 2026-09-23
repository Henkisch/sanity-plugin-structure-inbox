import {cleanup, render} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {InboxPane} from './InboxPane'

/**
 * `InboxPane`'s own job — reading `usePaneRouter().params` into `Inbox`'s
 * seed props, and wiring its three `onChange` callbacks back into
 * `setParams` — not `Inbox`'s rendering, which `Inbox.test.tsx` already
 * covers. `Inbox` itself is stubbed to a prop-recording component so these
 * assert on exactly what `InboxPane` hands it.
 */

const {usePaneRouterMock, useStructureToolMock, inboxPropsSpy} = vi.hoisted(() => ({
  usePaneRouterMock: vi.fn(),
  useStructureToolMock: vi.fn(),
  inboxPropsSpy: vi.fn(),
}))

vi.mock('sanity/structure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sanity/structure')>()),
  usePaneRouter: usePaneRouterMock,
  useStructureTool: useStructureToolMock,
}))

vi.mock('../inbox/Inbox', () => ({
  Inbox: (props: Record<string, unknown>) => {
    inboxPropsSpy(props)
    return null
  },
}))

interface FakePaneRouter {
  params?: Record<string, string | undefined>
  setParams: (params: Record<string, string | undefined>) => void
  BackLink?: undefined
}

function fakePaneRouter(
  params?: Record<string, string | undefined>,
  setParams: (params: Record<string, string | undefined>) => void = vi.fn(),
): FakePaneRouter {
  return {params, setParams, BackLink: undefined}
}

function lastInboxProps(): Record<string, unknown> {
  return inboxPropsSpy.mock.calls.at(-1)![0] as Record<string, unknown>
}

beforeEach(() => {
  // `CollapsedBackBar` calls this unconditionally; not collapsed is the
  // ordinary desktop case, which renders no back bar and so needs no
  // `BackLink` on the fake pane router above.
  useStructureToolMock.mockReturnValue({layoutCollapsed: false})
})

afterEach(() => {
  cleanup()
})

describe('InboxPane', () => {
  it("seeds Inbox with today's defaults when the pane has no params at all", () => {
    usePaneRouterMock.mockReturnValue(fakePaneRouter(undefined))

    render(<InboxPane />)

    const props = lastInboxProps()
    expect(props.initialView).toBe('open')
    expect(props.initialAssigneeFilter).toEqual(new Set())
    expect(props.initialTypeFilter).toEqual(new Set())
  })

  it('seeds Inbox from the params already on the pane', () => {
    usePaneRouterMock.mockReturnValue(
      fakePaneRouter({inboxView: 'snoozed', inboxAssignee: 'ada,bo', inboxType: 'drafts'}),
    )

    render(<InboxPane />)

    const props = lastInboxProps()
    expect(props.initialView).toBe('snoozed')
    expect(props.initialAssigneeFilter).toEqual(new Set(['ada', 'bo']))
    expect(props.initialTypeFilter).toEqual(new Set(['drafts']))
  })

  it("onViewChange preserves the pane's other existing params, and omits inboxView for the open default", () => {
    const setParams = vi.fn()
    usePaneRouterMock.mockReturnValue(
      fakePaneRouter({unrelated: 'kept', inboxView: 'cleared'}, setParams),
    )

    render(<InboxPane />)
    const onViewChange = lastInboxProps().onViewChange as (view: string) => void

    onViewChange('snoozed')
    expect(setParams).toHaveBeenCalledWith({unrelated: 'kept', inboxView: 'snoozed'})

    onViewChange('open')
    expect(setParams).toHaveBeenLastCalledWith({unrelated: 'kept', inboxView: undefined})
  })

  it("onAssigneeFilterChange preserves the pane's other existing params", () => {
    const setParams = vi.fn()
    usePaneRouterMock.mockReturnValue(fakePaneRouter({unrelated: 'kept'}, setParams))

    render(<InboxPane />)
    const onAssigneeFilterChange = lastInboxProps().onAssigneeFilterChange as (
      filter: ReadonlySet<string>,
    ) => void

    onAssigneeFilterChange(new Set(['ada']))
    expect(setParams).toHaveBeenCalledWith({unrelated: 'kept', inboxAssignee: 'ada'})

    onAssigneeFilterChange(new Set())
    expect(setParams).toHaveBeenLastCalledWith({unrelated: 'kept', inboxAssignee: undefined})
  })
})
