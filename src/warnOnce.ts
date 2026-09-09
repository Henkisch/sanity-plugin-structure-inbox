const warned = new Set<string>()

/**
 * Developer-facing console warning, emitted at most once per message per page
 * load.
 *
 * Structure resolvers re-run on every perspective, workspace and schema change,
 * so an unguarded `console.warn` here would repeat dozens of times in a session
 * and read like a loop rather than a note.
 *
 * @internal
 */
export function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[sanity-plugin-structure-home] ${message}`)
}

/** @internal */
export function resetWarnings(): void {
  warned.clear()
}
