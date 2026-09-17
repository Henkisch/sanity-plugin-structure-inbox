# npm publish checklist

**Status: published.** `sanity-plugin-structure-inbox@1.0.1` went out 2026-09-17 via semantic-release
(Trusted Publishing / OIDC). semantic-release computed `1.0.0` from conventional-commit history, not
the `0.1.0` this file originally anticipated. Kept as the reference for future releases.

## Before publishing

- [x] Backlog clear.
- [x] `version` in `package.json` — never hand-edit it; `semantic-release` (`.releaserc.json`,
      `@sanity/semantic-release-preset`) computes and writes it from conventional-commit history at
      release time.
- [x] Conventional-commit compliance: skim `git log --oneline` before tagging — the version bump
      depends on it.
- [x] `files: ["dist"]` whitelists only built output; `launch/`, `plans/`, `test-studio/` are excluded
      automatically. Confirm with `npm pack --dry-run` rather than assuming.
- [x] `LICENSE` present at repo root (MIT).
- [x] `exports`/`publishConfig.exports` point at `./dist/index.js` and `./dist/link-checker.js` —
      confirm `npm run build` produces both.
- [x] README's screenshots have real files in `media/` — a broken image on the npm page reads worse
      than no image.
- [x] `engines.node` (`>=20.19 <22 || >=22.12`) still matches what CI tests against.

## Dry run

```sh
npm run build
npm pack --dry-run
```

Review the file list — should be `dist/**` plus `package.json`, `README.md`, `LICENSE` (npm includes
those three by default regardless of `files`). Nothing from `launch/`, `plans/`, `src/`, or
`test-studio/` should appear.

## Release

semantic-release handles the version number, git tag, GitHub release notes and `CHANGELOG.md`, driven
entirely by commit messages since the last release. Nothing to do by hand beyond keeping commits clean
going in.

## After publishing

- [x] Package live at [npmjs.com/package/sanity-plugin-structure-inbox](https://www.npmjs.com/package/sanity-plugin-structure-inbox).
- [x] README badges render (shields.io self-populates once a version exists).
- [x] GitHub repo topics set (`sanity`, `sanity-plugin`, `sanity-io`, `sanity-studio`, `cms`,
      `headless-cms`, `contentops`, `inbox`) and homepage pointed at the npm page — these are the
      discovery path from GitHub search.
- [x] **Submitted to the Sanity Exchange** 2026-09-17. Listings are reviewed before they appear, so
      `sanity.io/plugins/sanity-plugin-structure-inbox` may 404 for a while yet — recheck in a few
      days rather than resubmitting.
- [x] **Posted `launch/discord-post.md`** 2026-09-17.
- [x] **Posted `launch/linkedin-post.md`** 2026-09-17.

Launch complete. The only thing still outstanding is the Exchange listing appearing, which is on
their review, not on us.

<details>
<summary>Original Exchange submission steps, for reference</summary>

- **Submit to the Sanity Exchange** — this is a *manual* submission, not npm-keyword indexing
      (an earlier version of this checklist had that wrong, which is why `sanity.io/plugins/...`
      still 404s). The Exchange is itself a Sanity Studio: log in at
      [community.sanity.tools](https://community.sanity.tools) with your Sanity account → **Help** →
      "Make your first contribution" → pick the **Plugin** category and fill in the fields there.
      Have ready: npm package name, GitHub repo URL, the one-line description from `package.json`,
      and `media/hero.png`.
</details>
