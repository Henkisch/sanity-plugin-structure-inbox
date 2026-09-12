import {describe, expect, it} from 'vitest'

import {resolveSnoozeUntil} from './snoozePresets'

describe('resolveSnoozeUntil', () => {
  it('later today is three hours on, whatever the hour', () => {
    const now = new Date('2026-06-01T10:00:00.000Z')
    expect(resolveSnoozeUntil('laterToday', now)).toBe('2026-06-01T13:00:00.000Z')
  })

  it('tomorrow lands at a fixed morning regardless of the current time', () => {
    const lateNight = new Date('2026-06-01T23:50:00')
    const resolved = new Date(resolveSnoozeUntil('tomorrow', lateNight))

    expect(resolved.getDate()).toBe(2)
    expect(resolved.getHours()).toBe(8)
    expect(resolved.getMinutes()).toBe(0)
  })

  it('next week is seven days on, at the same fixed morning', () => {
    const now = new Date('2026-06-01T09:00:00')
    const resolved = new Date(resolveSnoozeUntil('nextWeek', now))

    expect(resolved.getDate()).toBe(8)
    expect(resolved.getHours()).toBe(8)
  })
})
