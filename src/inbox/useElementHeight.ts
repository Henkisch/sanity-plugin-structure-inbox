import {type RefObject, useLayoutEffect, useState} from 'react'

/**
 * The live rendered height of `ref`'s element, in pixels — `undefined`
 * until the first measurement (the initial render, before layout, has
 * nothing to report yet).
 *
 * Measured synchronously on mount (and whenever `ref` changes) via
 * `useLayoutEffect`, so there is no render where a real element sits
 * unmeasured — `ResizeObserver`'s own first callback is always async,
 * which would otherwise cost a visible pop from a fallback height once
 * layout actually settles. `ResizeObserver` still owns every measurement
 * after that first one, for whatever later changes size (a new row in the
 * sidebar, the window resizing).
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined

    setHeight(element.getBoundingClientRect().height)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return height
}

/**
 * Same measurement, own axis — `ResponsiveColumns`' own `@container` query
 * (see its doc comment) stacks the two columns below 1024px of the pane's
 * *own* width, not the viewport's. `Inbox` mirrors that same threshold in
 * JS (see its `isStacked`) to know when capping the list's height to the
 * sidebar's is even meaningful — capped-with-its-own-scrollbar makes sense
 * only while the sidebar sits beside the list, not once it's stacked below.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number>()

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined

    setWidth(element.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return width
}
