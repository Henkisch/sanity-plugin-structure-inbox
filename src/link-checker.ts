/**
 * Optional integration with `sanity-plugin-link-checker`
 * (https://www.sanity.io/plugins/sanity-plugin-link-checker) — a separate
 * entry point (`sanity-plugin-structure-inbox/link-checker`), not part of
 * this package's main export.
 *
 * Every other source this plugin ships (`openTasks`, `unpublishedDrafts`,
 * `upcomingReleases`, `todos`) needs nothing beyond `sanity` itself.
 * `linkCheckerFindings` is different: it reads another, independently
 * versioned plugin's report document, so it depends on that plugin being
 * installed. Re-exporting it from the main `index.ts` barrel would make
 * `sanity-plugin-link-checker` a hard dependency of every consumer of this
 * package — even one that has never heard of link checking — the moment
 * any bundler resolves the barrel's imports. A separate entry point means
 * only a Studio that actually imports from here needs that package
 * installed at all; `sanity-plugin-link-checker` is listed as an optional
 * peer dependency of the whole package for exactly this reason.
 *
 * Usage, once `sanity-plugin-link-checker` (and its own `linkChecker()`
 * plugin, which is what actually runs scans) is set up in your Studio:
 *
 * ```ts
 * import {structureInbox} from 'sanity-plugin-structure-inbox'
 * import {linkCheckerFindings} from 'sanity-plugin-structure-inbox/link-checker'
 *
 * structureInbox({
 *   sources: [
 *     // ...your other sources
 *     linkCheckerFindings(),
 *   ],
 * })
 * ```
 */
export {linkCheckerFindings, type LinkCheckerFindingsOptions} from './inbox/sources/linkCheckerFindings'
