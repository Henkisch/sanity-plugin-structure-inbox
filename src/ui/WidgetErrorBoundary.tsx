import {Component, type ErrorInfo, type ReactNode} from 'react'

interface WidgetErrorBoundaryProps {
  children: ReactNode
  onCatch: (error: Error) => void
}

/**
 * A minimal error boundary.
 *
 * Sanity UI ships one, but its own types mark it `@beta` and "DO NOT USE IN
 * PRODUCTION", and `sanity` only re-exports its internal one. React offers no
 * hook equivalent, so a class component is the whole of the API here. It
 * renders no markup of its own, so the Sanity-UI-only rule for this pane is
 * untouched.
 */
export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps> {
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Developers get the component stack; editors get the card in `WidgetCard`.
    console.error('[sanity-plugin-structure-home] widget threw', error, info.componentStack)
    this.props.onCatch(error)
  }

  render(): ReactNode {
    return this.props.children
  }
}
