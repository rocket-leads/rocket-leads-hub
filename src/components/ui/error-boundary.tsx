"use client"

import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

type Props = {
  /** Children that may throw — the boundary catches React render errors
   *  from this subtree only, falling back to the inline UI below instead
   *  of tearing down the whole page. */
  children: ReactNode
  /** Optional override for the fallback UI. Receives the error + a reset
   *  function. When omitted the boundary renders its default amber card. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Short label shown above the error message so the user knows which
   *  subtree blew up. Defaults to "this section". */
  label?: string
  /** When this key changes the boundary auto-resets — useful for "user
   *  clicked a different row" so the error doesn't stick to the next item. */
  resetKey?: string | number
}

type State = { error: Error | null }

/**
 * Tiny error boundary for use around individual panels (inbox detail pane,
 * dialogs, etc.). NOT a global boundary — those belong in the Next.js
 * error.tsx files. This is for "if THIS panel's render throws, don't take
 * the page down with it."
 *
 * Class component because React still requires componentDidCatch to live
 * on a class. Everything around it is hooks — this is the one exception.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props) {
    // Reset when the consumer's resetKey changes (e.g. user navigates to a
    // different item) so a stuck error from item A doesn't poison item B.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Surface to the browser console so the user can copy/paste it. Avoids
    // a silent failure — without this the only signal is the fallback card.
    console.error("[ErrorBoundary] caught:", error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return (
        <div className="m-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <div className="flex items-center gap-2 mb-2 font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Something went wrong rendering {this.props.label ?? "this section"}.
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mb-3 font-mono break-all">
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[12px] rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
          >
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
