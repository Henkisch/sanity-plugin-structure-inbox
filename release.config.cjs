// @ts-check
const preset = require('@sanity/semantic-release-preset')

/**
 * Extends @sanity/semantic-release-preset with one extra rule: a `docs` commit scoped to `readme`
 * releases a patch.
 *
 * npm renders a package's README from the published tarball, so a README fix is invisible on
 * npmjs.com until a new version goes out. For a plugin whose npm page *is* its documentation,
 * that's a user-facing change and worth a version. The scope keeps it narrow — `docs(readme):`
 * publishes, while plain `docs:` commits (launch copy, plans, AGENTS.md) still don't.
 *
 * Built by patching the preset's plugin array rather than redeclaring it, since semantic-release
 * replaces `plugins` wholesale when a config defines it, and a hand-copied list would silently
 * drift from the preset on upgrade.
 */
module.exports = {
  ...preset,
  branches: ['main'],
  plugins: preset.plugins.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
      ? [plugin[0], {...plugin[1], releaseRules: [{type: 'docs', scope: 'readme', release: 'patch'}]}]
      : plugin,
  ),
}
