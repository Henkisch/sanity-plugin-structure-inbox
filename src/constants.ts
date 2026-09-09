/**
 * The id the Home pane is registered under, in the root list and in the URL
 * (`/structure/structure-home`).
 *
 * Deliberately verbose rather than the nicer-reading `home`: a singleton with
 * the id `home` is one of the most common things in a real Sanity structure,
 * and a collision would either shadow the editor's home page or throw
 * `List items with same ID found`.
 *
 * @public
 */
export const HOME_PANE_ID = 'structure-home'

/**
 * The tool this plugin attaches to unless `toolName` says otherwise. Matches
 * the default name given by `structureTool()`.
 *
 * @public
 */
export const DEFAULT_TOOL_NAME = 'structure'

/**
 * The i18n namespace this plugin registers its strings under. Studios override
 * any string by defining a bundle with this namespace.
 *
 * @public
 */
export const STRUCTURE_HOME_NAMESPACE = 'structureHome'

/** @internal */
export const PLUGIN_NAME = 'sanity-plugin-structure-home'

/**
 * API version used for this plugin's own queries.
 *
 * Pinned rather than tracking "latest": a query written against today's
 * semantics should not change meaning when Sanity ships a new API version.
 *
 * @internal
 */
export const API_VERSION = '2025-02-19'
