import {describe, expect, it} from 'vitest'

import {dueSubtitleKey, openTasks} from './openTasks'

// Plan 040: `useItems()` (and the `useTaskFetch()` it shares with
// `useOpenCount()`) call `useAddonDataset`/`useAgentClient`/`useCurrentUser`/
// `useAssignableUsers` — none of which have an existing mock harness in this
// suite, unlike `documentValidation.ts`'s or `assetIssues.ts`'s own pure
// helpers. `dueSubtitleKey` is the actual production code the `.map()` in
// `useTaskFetch()` calls to pick a row's subtitle key, pulled out specifically
// so this behavior is testable without that harness.
describe('dueSubtitleKey', () => {
  it('returns the overdue key for a due date already in the past', () => {
    expect(dueSubtitleKey('2000-01-01T00:00:00.000Z')).toBe('openTasks.overdue')
  })

  it('returns the due key for a due date still in the future', () => {
    expect(dueSubtitleKey('2999-01-01T00:00:00.000Z')).toBe('openTasks.due')
  })

  it('returns undefined for a row with no due date at all', () => {
    expect(dueSubtitleKey(undefined)).toBeUndefined()
  })
})

// Same reasoning as `documentValidation.test.ts`'s own `title` tests: the
// factory's `title` flows straight from the option into the returned
// `InboxSource` with no hooks in between, so this needs no render.
describe('openTasks title', () => {
  it('defaults to a translation key, not a bare English string', () => {
    expect(openTasks().title).toBe('source.openTasks.defaultTitle')
  })

  it('keeps a custom title exactly as given — never treated as a translation key', () => {
    expect(openTasks({title: 'My Custom Tasks'}).title).toBe('My Custom Tasks')
  })
})
