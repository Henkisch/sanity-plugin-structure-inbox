/** @internal */
export interface RedirectDecision {
  /** Whether the plugin is configured to redirect at all. */
  redirectOnLanding: boolean
  /** Whether the Inbox pane can actually be resolved for this tool. */
  inboxAvailable: boolean
  /** The tool the editor is currently in. */
  activeToolName: string
  /** The tool this plugin instance is attached to. */
  targetToolName: string
  /** The scoped router's `panes`, as-is. */
  panes: unknown
  /** The scoped router's `intent`, as-is. */
  intent: unknown
  /**
   * Whether the structure tool is showing one pane at a time — a phone, or a
   * narrow window.
   */
  collapsedLayout: boolean
}

/**
 * Whether an editor who just rendered the tool should be sent to the Inbox pane.
 *
 * Pulled out as a pure function because every one of these conditions is a bug
 * someone will hit in the wild — an intent stolen mid-resolution, a deep link
 * overwritten, the wrong tool hijacked — and each is far cheaper to pin down in
 * a test than in a Studio.
 *
 * @internal
 */
export function shouldRedirectToInbox(decision: RedirectDecision): boolean {
  if (!decision.redirectOnLanding) return false

  // Injection failed, so `/structure/structure-inbox` would resolve to nothing.
  if (!decision.inboxAvailable) return false

  // `activeToolLayout` wraps whichever tool is open, not just ours.
  if (decision.activeToolName !== decision.targetToolName) return false

  // A collapsed pane layout only shows the last pane, and the Inbox pane has
  // no header of its own to put a back link in, so redirecting here would
  // hide the root list behind a pane with no way out of it — the rest of the
  // structure would be unreachable on a phone. Landing on the root list is
  // both the escape hatch and what a stock Studio does; the Inbox is one tap
  // away through its entry in that list, which the plugin always adds for
  // exactly this reason.
  if (decision.collapsedLayout) return false

  // An intent is still resolving into panes. `IntentResolver` is about to
  // navigate; redirecting now would race it and win, dropping the editor's
  // document on the floor.
  if (typeof decision.intent === 'string') return false

  // The editor is somewhere — a deep link, or they navigated here themselves.
  if (Array.isArray(decision.panes) && decision.panes.length > 0) return false

  return true
}
