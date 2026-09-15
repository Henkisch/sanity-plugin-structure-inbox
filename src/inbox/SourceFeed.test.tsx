import {cleanup, render} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {EMPTY_SNOOZES} from '../store/snoozes'
import {type Snoozes} from '../store/useSnoozes'
import {SourceFeed, type SourceReport} from './SourceFeed'
import {type InboxSource, type InboxSourceResult} from './types'

afterEach(cleanup)

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
})
