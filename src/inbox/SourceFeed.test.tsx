import {cleanup, render} from '@testing-library/react'
import {useCallback, useState} from 'react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Snoozes} from '../store/useSnoozes'
import {SourceFeed, type SourceReport} from './SourceFeed'
import {type InboxSource, type InboxSourceResult} from './types'

afterEach(cleanup)

/** Stable across renders, the way `Inbox`'s own `now` state is. */
const NOW = Date.now()

function fakeSnoozes(): Snoozes {
  return {state: EMPTY_SNOOZES, snooze: vi.fn(), wake: vi.fn()}
}

describe('SourceFeed', () => {
  // One full result exercising every optional `InboxSourceResult` field at
  // once — a real bug this session found live: `reopen` was never added to
  // this component's own hardcoded destructure/capabilities/dependency-list
  // allowlist, so "Mark as not done" silently did nothing from the moment
  // the Cleared lifecycle shipped. `proposeFix`/`assigneeReadOnly`/
  // `openDetail` hit the exact same gap earlier the same session. This test
  // exists so the next field added there fails here instead of shipping
  // silently broken.
  it('forwards every capability a source can return, not just the ones already wired up', () => {
    const resolve = vi.fn()
    const reopen = vi.fn()
    const create = vi.fn()
    const assess = vi.fn()
    const proposeFix = vi.fn()
    const toUser = vi.fn()
    const remove = vi.fn()
    const update = vi.fn()
    const openDetail = vi.fn()
    const run = vi.fn()

    const result: InboxSourceResult = {
      items: [],
      resolve,
      reopen,
      create,
      assess,
      proposeFix,
      assign: {users: [], toUser},
      assigneeReadOnly: true,
      remove,
      update,
      openDetail,
      action: {label: 'Scan', run},
      acknowledgable: false,
    }

    const source: InboxSource = {name: 'everything', title: 'Everything', useItems: () => result}
    const onReport = vi.fn()

    render(<SourceFeed now={Date.now()} onReport={onReport} snoozes={fakeSnoozes()} source={source} />)

    expect(onReport).toHaveBeenCalledTimes(1)
    const report = onReport.mock.calls[0]?.[1] as SourceReport

    expect(report.resolve).toBe(resolve)
    expect(report.reopen).toBe(reopen)
    expect(report.create).toBe(create)
    expect(report.assess).toBe(assess)
    expect(report.proposeFix).toBe(proposeFix)
    expect(report.assign?.toUser).toBe(toUser)
    expect(report.assigneeReadOnly).toBe(true)
    expect(report.remove).toBe(remove)
    expect(report.update).toBe(update)
    expect(report.openDetail).toBe(openDetail)
    expect(report.action?.run).toBe(run)
    expect(report.acknowledgable).toBe(false)
  })

  // The test above hands `SourceFeed` one hoisted `result` object, which is
  // why it never caught this: a real hand-written source — including the one
  // the README documents — ends in `items: rows.map(toItem)`, allocating a new
  // array of new objects on every render. That identity used to flow straight
  // into the report effect's dependency list, so the effect re-fired on every
  // render, and `Inbox`'s own `setReports` re-rendered on every report. It
  // took a real Studio down with "Maximum update depth exceeded".
  it('reports once for a source that rebuilds its items on every render', () => {
    const source: InboxSource = {
      name: 'churning',
      title: 'Churning',
      useItems: () => ({
        items: [
          {
            id: 'doc-1',
            title: 'A draft',
            subtitle: 'Post',
            timestamp: '2026-09-18T08:00:00.000Z',
            intent: {type: 'edit', params: {id: 'doc-1', type: 'post'}},
          },
        ],
      }),
    }

    const onReport = vi.fn()

    // Stands in for `Inbox`: every report sets state, so a redundant report
    // costs another render, which is what closes the loop in the real pane.
    function Host() {
      const [, setReports] = useState<Record<string, SourceReport>>({})
      // Memoized, and storing the report unconditionally — exactly what
      // `Inbox.handleReport` did before it gained its own equality guard, so
      // what this asserts is `SourceFeed`'s own restraint, not the guard's.
      const handleReport = useCallback((sourceName: string, report: SourceReport) => {
        onReport(sourceName, report)
        setReports((current) => ({...current, [sourceName]: report}))
      }, [])
      return <SourceFeed now={NOW} onReport={handleReport} snoozes={fakeSnoozes()} source={source} />
    }

    render(<Host />)

    expect(onReport).toHaveBeenCalledTimes(1)
    const report = onReport.mock.calls[0]?.[1] as SourceReport
    expect(report.open).toHaveLength(1)
  })
})

describe('SourceFeed with an item value that never compares equal', () => {
  // `sameItems` falls back to `===` for anything that is not a primitive, a
  // plain object or an array, so a per-render `icon` compares unequal forever.
  // Shipped in 1.0.4, this looped in the render phase — upstream of
  // `sameReport` and of the error boundary, so nothing downstream could contain
  // it. `useStableItems` now bounds its own adoptions instead.
  it('settles instead of looping when every item carries a fresh icon', () => {
    const source: InboxSource = {
      name: 'churningIcon',
      title: 'Churning icon',
      useItems: () => ({
        items: [
          {
            id: 'doc-1',
            title: 'A draft',
            icon: () => null,
            intent: {type: 'edit' as const, params: {id: 'doc-1', type: 'post'}},
          },
        ],
      }),
    }

    const onReport = vi.fn()
    function Host() {
      const [, setReports] = useState<Record<string, SourceReport>>({})
      const handleReport = useCallback((sourceName: string, report: SourceReport) => {
        onReport(sourceName, report)
        setReports((current) => ({...current, [sourceName]: report}))
      }, [])
      return <SourceFeed now={NOW} onReport={handleReport} snoozes={fakeSnoozes()} source={source} />
    }

    expect(() => render(<Host />)).not.toThrow()
    expect(onReport.mock.calls.length).toBeLessThan(10)
  })
})
