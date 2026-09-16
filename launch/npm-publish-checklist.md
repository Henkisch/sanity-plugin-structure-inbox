# npm publish checklist

Reference for whenever the backlog clears — **not** an instruction to publish now. Per [[feedback_release_last]], v0.1.0 ships last, once the badge-size and findings-as-rows items are done.

## Before publishing

- [ ] Backlog clear: number-badge standardization + "findings as rows" idea resolved or explicitly deferred.
- [ ] `version` in `package.json` — leave at `0.0.0`; `semantic-release` (`.releaserc.json`, `@sanity/semantic-release-preset`) computes and writes the real version from conventional-commit history at release time. Do not hand-edit it.
- [ ] Conventional-commit compliance: skim `git log --oneline` for anything that doesn't start with `feat:`/`fix:`/`chore:`/`refactor:`/etc. — semantic-release's version bump depends on this. The 149 commits so far look compliant.
- [ ] `files: ["dist"]` in `package.json` already whitelists only the built output — `launch/`, `plans/`, `test-studio/`, and everything else at the repo root are excluded from the published tarball automatically, no `.npmignore` needed. Confirm with `npm pack --dry-run` (see below) rather than assuming.
- [ ] `LICENSE` file present at repo root — it is (MIT, confirmed).
- [ ] `exports`/`publishConfig.exports` point at `./dist/index.js` and `./dist/link-checker.js` — confirm `npm run build` produces both before tagging a release.
- [ ] README's four screenshot placeholders (`media/hero.png`, `media/ask-ai.png`, `media/ai-insights.png`, `media/assign.png`) have real files in `media/` — a broken image on the npm page reads worse than no image.
- [ ] `engines.node` (`>=20.19 <22 || >=22.12`) still matches what CI actually tests against.

## Dry run

```sh
npm run build
npm pack --dry-run
```

Review the file list in the output — should be `dist/**` plus `package.json`, `README.md`, `LICENSE` (npm includes these three by default regardless of `files`). Nothing from `launch/`, `plans/`, `src/`, or `test-studio/` should appear.

## Release

- semantic-release handles: version number, git tag, GitHub release notes, and (first run) the initial `CHANGELOG.md` — driven entirely by commit messages since the last release. Nothing to do by hand beyond making sure commits are clean going in.
- After the first successful publish, verify the package appears at `npmjs.com/package/sanity-plugin-structure-inbox`.

## After publishing

- [ ] Confirm the plugin surfaces on `sanity.io/plugins` (indexed from the `sanity-plugin` keyword + npm metadata — can take some time to appear; no manual submission step found).
- [ ] Post `launch/discord-post.md` and `launch/linkedin-post.md` once the npm install command in them actually resolves to a real published version.
- [ ] Update badges in README — the shields.io badges already point at the real npm package name, so they'll self-populate once a version exists; no edit needed, just verify they render (not "package not found").
