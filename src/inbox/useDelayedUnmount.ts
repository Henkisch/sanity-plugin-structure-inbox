import {useEffect, useState} from 'react'

/**
 * Keeps rendering `true` for `delayMs` after `active` goes false — long
 * enough for a CSS collapse transition to finish before the content it was
 * animating actually disappears. The `grid-template-rows: 0fr` trick this
 * exists for only looks smooth while there's still something to shrink
 * around; unmount the instant selection clears and the row snaps instead of
 * easing shut.
 */
export function useDelayedUnmount(active: boolean, delayMs: number): boolean {
  const [rendered, setRendered] = useState(active)
  const [prevActive, setPrevActive] = useState(active)

  // React's sanctioned way to react to a changed input without an effect:
  // adjust state directly during render. `active` becoming true shows the
  // content on this same render instead of a tick later, and resets whatever
  // hide `useEffect` below may have had pending from before.
  if (active !== prevActive) {
    setPrevActive(active)
    if (active) setRendered(true)
  }

  useEffect(() => {
    if (active) return undefined
    const id = setTimeout(() => setRendered(false), delayMs)
    return () => clearTimeout(id)
  }, [active, delayMs])

  return rendered
}
