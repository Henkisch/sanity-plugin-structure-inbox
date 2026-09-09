import {Component, type ErrorInfo, type ReactNode} from 'react'

interface SectionErrorBoundaryProps {
  children: ReactNode
  onCatch: (error: Error) => void
  /**
   * What to render once an error has been caught, in place of `children`.
   *
   * Either a fixed node or a function of the caught error, for callers that
   * want to show the error's message.
   */
  fallback: ReactNode | ((error: Error) => ReactNode)
}

interface SectionErrorBoundaryState {
  error: Error | null
}

/**
 * A minimal error boundary.
 *
 * Sanity UI ships one, but its own types mark it `@beta` and "DO NOT USE IN
 * PRODUCTION", and `sanity` only re-exports its internal one. React offers no
 * hook equivalent, so a class component is the whole of the API here. It
 * renders no markup of its own beyond `fallback`, so the Sanity-UI-only rule
 * for this pane is untouched.
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {error: null}

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return {error}
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developers get the component stack; editors get the message in the card.
    console.error('[sanity-plugin-structure-inbox] inbox source threw', error, info.componentStack)
    this.props.onCatch(error)
  }

  render(): ReactNode {
    const {error} = this.state
    if (error) {
      return typeof this.props.fallback === 'function' ? this.props.fallback(error) : this.props.fallback
    }

    return this.props.children
  }
}
