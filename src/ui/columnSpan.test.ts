import {describe, expect, it} from 'vitest'

import {columnSpanFor, GRID_COLUMNS} from './columnSpan'

describe('columnSpanFor', () => {
  it('never spans more columns than the grid has at that breakpoint', () => {
    // An overshooting span makes CSS grid add a column, which breaks the
    // alignment of every other widget on the pane.
    for (const width of ['small', 'medium', 'large', 'full'] as const) {
      columnSpanFor(width).forEach((span, index) => {
        expect(span).toBeLessThanOrEqual(GRID_COLUMNS[index])
      })
    }
  })

  it('gives each width a distinct span at the widest breakpoint', () => {
    const widest = (width: Parameters<typeof columnSpanFor>[0]) => columnSpanFor(width).at(-1)

    expect([widest('small'), widest('medium'), widest('large'), widest('full')]).toEqual([
      1, 2, 3, 4,
    ])
  })

  it('defaults to medium', () => {
    expect(columnSpanFor()).toEqual(columnSpanFor('medium'))
  })
})
