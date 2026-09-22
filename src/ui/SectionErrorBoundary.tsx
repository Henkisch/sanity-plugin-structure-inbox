import {Component, type ErrorInfo, type ReactNode} from 'react'

/**
 * How many times a single boundary instance will clear a caught error and
 * remount `children` — whether the reset comes from a `resetKey` change or
 * from the `retry` callback handed to `fallback`. A transient failure (a
 * dropped listener, one 5xx) recovers well within this many tries; a
 * deterministic throw spends the whole budget and then latches for good.
 * Unbounded reset would reinstate the loop this boundary exists to contain:
 * a deterministic throw would remount, throw, remount forever. Same
 * trade-off as `MAX_CONSECUTIVE_ADOPTIONS` in `useStableItems.ts`, applied
 * to remounts instead of item-array adoptions.
 */
const MAX_RESETS = 3

interface SectionErrorBoundaryProps {
  children: ReactNode
  onCatch: (error: Error) => void
  /**
   * What to render once an error has been caught, in place of `children`.
   *
   * Either a fixed node, or a function of the caught error and a `retry`
   * callback. `retry` is `undefined` once the reset budget (`MAX_RESETS`) is
   * spent — a caller drawing a "Try again" button can use that to stop
   * offering one. A caller with no retry UI of its own (a fallback of `null`,
   * driving resets purely through `resetKey`) can ignore the second argument
   * entirely.
   */
  fallback: ReactNode | ((error: Error, retry: (() => void) | undefined) => ReactNode)
  /**
   * Changing this value (compared with `!==`) clears a caught error and
   * remounts `children`, subject to the same `MAX_RESETS` budget `retry`
   * spends — a parent driving resets this way cannot loop any harder than a
   * user clicking "Try again" could. `undefined` (the default) never
   * triggers a reset on its own.
   */
  resetKey?: unknown
}

interface SectionErrorBoundaryState {
  error: Error | null
  /** How many resets this instance has already spent, out of `MAX_RESETS`. */
  resetCount: number
}

/**
 * A minimal error boundary.
 *
 * Sanity UI ships one, but its own types mark it `@beta` and "DO NOT USE IN
 * PRODUCTION", and `sanity` only re-exports its internal one. React offers no
 * hook equivalent, so a class component is the whole of the API here. It
 * renders no markup of its own beyond `fallback`, so the Sanity-UI-only rule
 * for this pane is untouched.
 *
 * Resets are bounded (see `MAX_RESETS`) rather than either extreme: latching
 * forever turns a transient failure (a dropped listener, one 5xx) into a
 * permanent one, and an unbounded reset turns a genuinely broken source back
 * into the crash loop this boundary exists to contain. Both `resetKey` and
 * `retry` spend the same per-instance budget, so combining them (a parent
 * that both offers a click and bumps a shared key) still cannot exceed it.
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {error: null, resetCount: 0}

  static getDerivedStateFromError(error: Error): Pick<SectionErrorBoundaryState, 'error'> {
    return {error}
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developers get the component stack; editors get the message in the card.
    console.error('[sanity-plugin-structure-inbox] inbox source threw', error, info.componentStack)
    this.props.onCatch(error)
  }

  componentDidUpdate(prevProps: SectionErrorBoundaryProps): void {
    // Only ever fires while latched (`state.error` set) and only on a genuine
    // change of `resetKey` — not on every update, which would otherwise
    // re-arm on unrelated re-renders and defeat the point of comparing it.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset()
    }
  }

  /**
   * Clears the caught error so `children` mounts fresh, if the budget allows
   * — a silent no-op past `MAX_RESETS` rather than throwing, since both call
   * sites (a `resetKey` change, a fallback's own retry click) treat "did
   * nothing" as the correct outcome of an exhausted budget, not a bug.
   */
  reset = (): void => {
    if (this.state.resetCount >= MAX_RESETS) return
    this.setState((current) => ({error: null, resetCount: current.resetCount + 1}))
  }

  render(): ReactNode {
    const {error} = this.state
    if (error) {
      const retry = this.state.resetCount < MAX_RESETS ? this.reset : undefined
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(error, retry)
        : this.props.fallback
    }

    return this.props.children
  }
}
