# Plan 067: Make the public API surface reviewable before another export sneaks in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- package.config.ts package.json src/index.ts src/link-checker.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

> **Amended 2026-09-22 after execution.** Steps 1–2 landed and are approved.
> Steps 3–4 are withdrawn: the premise that this build emits an API report is
> false, proven by reading `@sanity/tsdown-config`'s compiled source. The
> corrected Step 4 text is below and still wants doing.

## Status

- **Priority**: P2
- **Effort**: S — but the first run surfaces a batch of missing tags at once, which is a chore rather than a risk.
- **Risk**: LOW-MED — cannot change runtime behaviour. The only way it breaks anything is if a tag decision accidentally un-exports something.
- **Depends on**: none. **Unblocks plans 071 and 083** — do this first if executing any of the three.
- **Category**: dx
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

This package is published on npm at 2.x. Every exported symbol is a semver
commitment. Right now **nothing mechanically knows what the surface is**:

- API Extractor's release-tag checks are switched off in `package.config.ts`,
  above a comment saying to remove the block to enable them. It is the
  `@sanity/plugin-kit` scaffold default, left in place.
- There is no `etc/*.api.md` report committed, so a PR that adds or changes an
  export produces no reviewable diff of the surface.

The cost is already visible and has its own plans: nine symbols are published
with no documentation (plan 083), and one undocumented export inlines ~10,000
lines of `@sanity/client` types into every consumer's type graph (plan 071).
`ae-missing-release-tag` is precisely the check that would have flagged them.

So this plan is a guard, not a fix, and it floats above its raw impact because
it makes the other two mechanical instead of a manual audit — and stops the
next one happening.

## Current state

`package.config.ts:7-13` — the disabled checks:

```ts
tsdoc: {
  rules: {
    'ae-missing-release-tag': 'off',
    'ae-internal-missing-underscore': 'off',
    'ae-incompatible-release-tags': 'off',
  },
},
// Remove this block to enable stricter TSDoc / API Extractor checks
```

(Read the real file — the exact key names and the comment's position may differ
slightly from this excerpt; the three rule names are the load-bearing part.)

No `etc/` directory exists. Confirm with `ls etc 2>&1`.

**Repo conventions that apply here**:
- Release tags in this codebase are TSDoc comments: `@public` for integrator-facing API, `@internal` for anything else. `src/inbox/types.ts` has many `@public` examples; `src/inbox/sources/capability.ts` uses `@internal`-style framing in prose.
- `npm run build` runs `plugin-kit verify-package --silent` then `pkg-utils build --strict --check --clean`. API Extractor runs inside that build, so enabling the rules makes the build the gate.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0, no output   |
| Lint      | `npm run lint`      | exit 0, no output   |
| Build (the gate) | `npm run build` | `[success]`     |
| Tests     | `npm test`          | all pass            |

## Scope

**In scope:**
- `package.config.ts` — remove the `tsdoc` rules block
- TSDoc release tags on exported symbols, wherever the enabled checks flag them
- `etc/` — commit the generated API report
- `.gitignore` — only if `etc/` is currently ignored

**Out of scope** (do NOT touch, even though they look related):
- **Removing or renaming any export.** That is semver-major and is plan 083's decision to stage. This plan only *tags* and *reports*. If a symbol looks like it should not be public, tag it `@internal` and record it — do not delete it.
- Narrowing `useAssignmentStore`'s parameter type (plan 071).
- README documentation (plan 083).
- Any `src/` change other than adding a TSDoc tag comment.

## Git workflow

- Branch: `advisor/067-api-report`
- Conventional Commits. `chore:` or `build:` for enabling the checks; `docs:` if the commit is mostly tags. Note from `release.config.cjs`: `docs(readme):` cuts a **patch release** — so do not use that scope unless a release is wanted.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Turn the checks on and see the damage

Remove the `tsdoc.rules` block from `package.config.ts` (and the comment that
says to remove it).

Run `npm run build`. It will fail with a list of API Extractor warnings.

**Capture that list verbatim into your report before changing anything else.**
It is the inventory this plan exists to produce, and plans 071 and 083 depend
on it.

**Verify**: `npm run build` fails with `ae-missing-release-tag` (or similar)
warnings, and you have the full list recorded.

### Step 2: Tag every flagged symbol, deciding each one

For each flagged symbol, add either `@public` or `@internal` to its TSDoc
comment. The decision rule:

- **`@public`** — an integrator can reasonably be expected to use it, and the
  README documents it or should. Examples already in this shape: `InboxSource`,
  `InboxItem`, the source factory functions, `buildDigest`, `parseSnoozes`.
- **`@internal`** — it is exported for the plugin's own plumbing or for a
  single documented recipe, and nobody outside should depend on it.

The known candidates from prior audit work (verify against your Step 1 list
rather than trusting this): `SectionCard`, `useAssignmentStore`,
`assignmentDocId`, `AssignmentStore`, `suggestAltText`, `AltContext`,
`AssetTarget`, `parseDismissals`, `isDismissed`, `parseTodos`,
`parseAssessments`.

**Do not un-export anything in this step**, even where `@internal` feels like
it should mean removal. Tagging is non-breaking; removing is not.

If `ae-internal-missing-underscore` objects to an `@internal` export not being
named with a leading underscore, do **not** rename the symbol — that is a
breaking change. Instead re-enable just that one rule as `'off'` with a comment
explaining why (renaming published symbols costs more than the rule buys), and
say so in your report.

**Verify**: `npm run build` → `[success]`.

### Step 3 — WITHDRAWN: this build cannot produce an API report

**Do not attempt this step.** It was written on a false premise and the
executor proved it false.

`pkg-utils build --strict --check` calls `@sanity/tsdown-config`'s
`checkTsdoc`, which constructs its API Extractor config with
`apiReport.enabled: false`, `docModel.enabled: false` and
`dtsRollup.enabled: false` **hardcoded**
(`node_modules/@sanity/tsdown-config/dist/tsdoc.mjs`). It invokes
`Extractor.invoke` purely to collect lint messages — the release-tag check —
and never writes a report file. `package.config.ts`'s `tsdoc.rules` only
decides which of those messages are errors, warnings or off; there is no knob
in this chain that turns report-writing on. Grepping
`@sanity/pkg-utils/dist` for `api.md`/`apiReport`/`etc/` returns zero hits.

So there is no `etc/*.api.md` to commit, and `git`-diffable API surface is not
available from this build as it stands.

Two routes exist for a maintainer who wants it, both out of this plan's scope
because both are architecture decisions rather than execution:

- run `@microsoft/api-extractor` directly against `dist/index.d.ts` with a
  hand-written `api-extractor.json` that enables `apiReport`, as its own
  build/CI step alongside `pkg-utils`
- file the gap upstream against `@sanity/tsdown-config`/`@sanity/pkg-utils`

### Step 4 — WITHDRAWN with Step 3

The `AGENTS.md` note this plan specified asserts the report is "generated by
API Extractor during `npm run build`". That is the claim Step 3 just
falsified, so adding it would document a mechanism that does not exist.

**What to write instead** (and this plan's executor should do it):

> The build enforces release tags: every export needs `@public` or
> `@internal` in its TSDoc, or `npm run build` fails with
> `ae-missing-release-tag`. That check is the guard on a 2.x package's public
> surface — a new export is a semver commitment, so tagging it is a decision,
> not a formality. Note the build does **not** emit an `etc/*.api.md` report:
> `@sanity/tsdown-config` hardcodes `apiReport.enabled: false` and runs API
> Extractor only for the lint. There is therefore no diffable snapshot of the
> surface; the tag requirement is what stands in for it.

## Test plan

No unit tests — this is build tooling. The verification is the build itself,
plus one deliberate check that the guard works:

1. Temporarily add `export const __guardCheck = 1` to `src/index.ts` with no
   TSDoc tag.
2. `npm run build` → **must fail** with a missing-release-tag error.
3. Remove it.

Record that you ran this. Without it, you have not shown the guard is live.

**Verify**: `npm test` → all pass (unchanged; this plan touches no runtime code).

## Done criteria

ALL must hold:

- [ ] `package.config.ts` no longer disables `ae-missing-release-tag` or `ae-incompatible-release-tags` (any rule left `'off'` has a comment saying why)
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0
- [ ] The Step 1 warning list is recorded verbatim in your report, with a `@public`/`@internal` verdict per symbol
- [ ] The corrected Step 4 note (the one that does NOT claim a report is generated) is in `AGENTS.md`
- [ ] The guard check (deliberate untagged export → build fails) was run and recorded
- [ ] `git diff` shows **no** exported symbol removed or renamed
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 produces more than ~25 warnings. That is a bigger inventory than this
  plan assumes and the tagging decisions want a maintainer pass, not an
  executor's judgement.
- Any rule cannot be satisfied without renaming or removing a published
  symbol. Report which symbol and which rule; do not make the breaking change.
- The build produces no API report at all (API Extractor may not be wired into
  this build in the way this plan assumes). Report what the build actually
  emits.
- The guard check in the test plan does **not** fail the build. Then the rules
  are not actually enforced and the whole plan is decorative — say so.

## Maintenance notes

- After this, the API report diff is the review artifact for every future
  export. A PR that touches `etc/*.api.md` without mentioning it in its
  description should be questioned.
- Plans 071 and 083 both consume Step 1's inventory. Execute this first.
- Deferred deliberately: actually removing the symbols that end up `@internal`.
  That is a 3.0 decision, and the tag is what makes it a decision rather than
  an accident.
