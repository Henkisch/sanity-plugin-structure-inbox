/**
 * Whether the Home pane can actually be resolved, keyed by tool name.
 *
 * The landing redirect and the pane wiring live in different parts of the
 * config — `studio.components.activeToolLayout` and `tools` — and only the
 * second one can tell whether the wiring succeeded, because that answer depends
 * on what the developer's structure resolver returns at render time.
 *
 * The ordering works out: `ActiveToolLayout` wraps the structure tool, so
 * `StructureToolProvider` runs the (wrapped) resolver during render, while the
 * redirect runs in an effect after commit. By then this map is accurate.
 *
 * @internal
 */
const availability = new Map<string, boolean>()

/** @internal */
export function setHomeAvailable(toolName: string, available: boolean): void {
  availability.set(toolName, available)
}

/** @internal */
export function isHomeAvailable(toolName: string): boolean {
  return availability.get(toolName) === true
}

/** @internal */
export function resetHomeAvailability(): void {
  availability.clear()
}
