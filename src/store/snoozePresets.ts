/**
 * The three "snooze until" choices offered in the selection bar.
 *
 * A fixed, small set rather than a date picker: an editor picking a preset is
 * choosing a mood ("get this off my plate for now"), not a precise moment.
 *
 * @public
 */
export type SnoozePreset = 'laterToday' | 'tomorrow' | 'nextWeek'

const MORNING_HOUR = 8

/** The same clock time, moved to a fixed morning hour. */
function atMorning(date: Date): Date {
  const next = new Date(date)
  next.setHours(MORNING_HOUR, 0, 0, 0)
  return next
}

/**
 * Resolves a preset to the ISO timestamp it wakes the item at.
 *
 * "Later today" is a fixed offset, not a time of day: whatever hour an editor
 * snoozes at, three hours on is still later today. "Tomorrow" and "next week"
 * land at a fixed morning instead — a 23:50 snooze should not wake someone a
 * few minutes later.
 */
export function resolveSnoozeUntil(preset: SnoozePreset, now = new Date()): string {
  switch (preset) {
    case 'laterToday':
      return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString()
    case 'tomorrow': {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      return atMorning(tomorrow).toISOString()
    }
    case 'nextWeek': {
      const nextWeek = new Date(now)
      nextWeek.setDate(nextWeek.getDate() + 7)
      return atMorning(nextWeek).toISOString()
    }
    default: {
      const exhaustive: never = preset
      throw new Error(`Unknown snooze preset: ${String(exhaustive)}`)
    }
  }
}
