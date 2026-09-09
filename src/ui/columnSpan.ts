import {type WidgetWidth} from '../types'

/**
 * The Home grid, expressed once.
 *
 * Four columns at the widest breakpoint gives every {@link WidgetWidth} a
 * distinct size — with three, `medium` and `large` would collapse into the same
 * span and the option would be a lie.
 */
export const GRID_COLUMNS = [1, 1, 2, 4]

const SPANS: Record<WidgetWidth, number> = {
  small: 1,
  medium: 2,
  large: 3,
  full: 4,
}

/**
 * Turns a widget's requested width into a responsive `gridColumn` span that never
 * exceeds the number of columns available at that breakpoint — an overshooting
 * span makes CSS grid add a column and break the rhythm of the whole pane.
 */
export function columnSpanFor(width: WidgetWidth = 'medium'): number[] {
  const span = SPANS[width] ?? SPANS.medium
  return GRID_COLUMNS.map((columns) => Math.min(span, columns))
}
