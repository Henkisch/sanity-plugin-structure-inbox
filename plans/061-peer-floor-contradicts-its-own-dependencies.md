# Plan 061: Support the whole advertised peer range, without a breaking change

> **Status: REWRITTEN 2026-09-22.** The first version of this plan was wrong in
> three ways, and the investigation it *asked for* (its own Step 1) is what
> proved it. The corrections are recorded in "What the first version got wrong"
> below rather than deleted, because the wrong reasoning is the more
> instructive half.
>
> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update this plan's status row in `plans/README.md`.
>
> **No maintainer decision is needed any more.** The original plan presented two
> options, one breaking. The investigation below removed the need for the
> breaking one.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- package.json AGENTS.md README.md src/inbox/sources/documentValidation.ts src/inbox/sources/assetIssues.ts src/inbox/projectDigest.ts src/inbox/AddMenu.tsx`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (was MED). The change is two range strings, and the compatibility question behind it is now answered with evidence rather than assumed.
- **Depends on**: none
- **Category**: bug (dependency resolution)
- **Planned at**: commit `3893ae5`, 2026-09-21. **Rewritten** against `advisor/integration`, 2026-09-22.

## Why this matters

`package.json` advertises `peerDependencies.sanity: ^6.10.0` while declaring
`@sanity/types: ^6.13.0` and `@sanity/validation: ^6.13.0` as its own
dependencies. `sanity` pins its Sanity-scoped dependencies to **exact**
versions, so on any studio below 6.13 npm has no choice but to nest a second
copy of whatever the plugin asks for.

That is real, and it is worth fixing. What it is *not* is dangerous — see
below. The fix is to widen two ranges so npm can dedupe, which is
non-breaking for every existing consumer.

## What the investigation found

All of this was verified against the npm registry and the packages' own
published code on 2026-09-22. Reproduce any of it with the commands in
"Evidence commands".

**1. `@sanity/validation` did not exist before 6.12.**

```
sanity@6.10.0  types=6.10.0  validation=SAKNAS
sanity@6.11.0  types=6.11.0  validation=SAKNAS
sanity@6.12.0  types=6.12.0  validation=6.12.0
sanity@6.13.0  types=6.13.0  validation=6.13.0
```

`@sanity/validation`'s first stable 6.x release is **6.12.0**; there is no
6.10.x or 6.11.x at all. So on a 6.10 or 6.11 studio there is **no second copy
of validation** — the plugin's own copy is the only one in the tree. Half the
original finding described a duplication that cannot happen.

**2. The three functions the plugin uses from `@sanity/types` are
byte-identical between 6.10.0 and 6.13.0.**

The plugin's entire runtime surface from that package is three type guards:

- `isDocumentSchemaType` — `src/inbox/AddMenu.tsx:2`, `src/inbox/projectDigest.ts:1`, `src/inbox/sources/assetIssues.ts:2`
- `isImageSchemaType` — `src/inbox/sources/assetIssues.ts:2`
- `isObjectSchemaType` — used internally by the other two

All three compare identically across the two versions, and all three are pure
duck-typing — they walk the `.type` chain looking for `name === "document"`:

```js
function isDocumentSchemaType(type) {
	if (!isObjectSchemaType(type)) return !1;
	let current = type;
	for (; current;) {
		if (current.name === "document") return !0;
		...
```

`grep -c "instanceof\|Symbol("` over the whole 6.10.0 bundle returns **0**. So a
6.13 copy of these guards, applied to a 6.10 studio's schema objects, behaves
exactly as a 6.10 copy would. A duplicate copy costs bundle size, not
correctness.

**3. Therefore the `@sanity/ui` analogy does not hold.** That incident (recorded
in `AGENTS.md`) was v3 against v4 with a genuine behavioural divergence — a
`Checkbox`'s visually-hidden input lost its positioned wrapper and swallowed
every click. Nothing comparable is in play here: identical pure functions over
plain objects.

## What the first version of this plan got wrong

Recorded so the next reader trusts the corrected version and not the habit of
reasoning that produced the first one:

1. It asserted `@sanity/validation@6.10.0` could be checked for API parity. That
   version does not exist.
2. It presented raising `peerDependencies.sanity` to `^6.13.0` — a **breaking
   change** — as the zero-risk option, and widening as the risky one. It is the
   other way round.
3. It claimed this was "structurally the same failure" as the `@sanity/ui`
   incident. It is not; that one had real behavioural divergence, this one does
   not.

The lesson worth keeping: the plan reasoned from a *pattern* ("bundled Sanity
internal + lower peer floor = the ui incident") without checking whether the
pattern's load-bearing part — behavioural divergence — was actually present.

## Current state

`package.json` — the two ranges to change:

```json
"dependencies": {
  "@sanity/types": "^6.13.0",
  "@sanity/validation": "^6.13.0",
```

`package.json` — the peer floor, which **stays as it is**:

```json
"peerDependencies": {
  "sanity": "^6.10.0"
```

`AGENTS.md` has a section titled "The `sanity` peer floor is `^6.10.0`, and it is
load-bearing", whose governing rule is:

> Do not widen this range to court older studios. A refused install is the
> feature.

That forbids widening the **peer** range. This plan does not touch it; it
widens two **dependency** ranges so the existing peer range becomes honest.
Say so explicitly in the commit body so a future reader does not mistake one
for the other.

## Evidence commands

Read-only. Run these if you want to confirm the findings yourself before
changing anything:

```
npm view sanity@6.10.0 dependencies --json
npm view @sanity/validation versions --json
npm pack @sanity/types@6.10.0    # into a scratch dir, NOT the repo
```

## Commands you will need

| Purpose   | Command                | Expected on success |
|-----------|------------------------|---------------------|
| Typecheck | `npm run typecheck`    | exit 0, no output   |
| Lint      | `npm run lint`         | exit 0, no output   |
| Tests     | `npm test`             | all pass            |
| Build     | `npm run build`        | `[success]`         |

`npm run build` runs `plugin-kit verify-package` first, which checks the
manifest — that is the gate that matters here.

## Scope

**In scope:**
- `package.json` — the two dependency ranges only
- `AGENTS.md` — the new invariant in Step 3

**Out of scope** (do NOT touch):
- `peerDependencies.sanity`. It stays `^6.10.0`. This plan makes that promise true rather than changing it.
- `src/` — the call sites are correct. Do not change code to accommodate a dependency range.
- `@sanity/ui` and `@sanity/icons` ranges. Their arrangement is deliberate and documented in `AGENTS.md`; `verify-package` requires `@sanity/ui` to be a dependency. Do not "consistency-fix" them.
- `package.json`'s `inlinedDependencies` (separate known issue).

## Git workflow

- Branch: you will be told which worktree/branch to use; commit there.
- Conventional Commits. This is a `fix:` — **not** breaking.
  State in the commit body that this widens *dependency* ranges, not the peer
  range, and that `AGENTS.md`'s prohibition is on the latter.

## Steps

### Step 1: Widen the two ranges

```json
"@sanity/types": "^6.10.0",
"@sanity/validation": "^6.12.0",
```

Note the asymmetry, and keep it: `^6.12.0` for validation because **no lower
6.x exists**. Writing `^6.10.0` there would be a range npm resolves to 6.12
anyway, i.e. a claim the registry cannot honour. `^6.12.0` is the honest floor
and still lets a 6.12-or-later studio dedupe onto its own copy.

**Verify**: `npm run build` → `[success]`, `npm run typecheck` → exit 0.

### Step 2: Confirm the install actually dedupes

A unit test cannot observe npm's resolution. Do this in a scratch directory
**outside the repo** (e.g. `/tmp/peer-dedupe-check`):

1. `npm pack` in the repo produces a tarball (read-only with respect to the repo).
2. In the scratch dir: `npm init -y`, then install `sanity@6.12.0` plus that tarball.
3. `npm ls @sanity/types @sanity/validation`

**Expected**: one copy of each, deduped at the top level — no `node_modules`
nested under the plugin.

4. Repeat with `sanity@6.10.0`. Expected there: `@sanity/types` deduped onto
   the studio's 6.10.0; `@sanity/validation` present once, from the plugin only
   (the studio does not depend on it at that version).
5. Delete the scratch directory.

Record both `npm ls` outputs verbatim in your report. **This is the only
verification that speaks to this plan's actual claim** — do not substitute a
typecheck for it.

### Step 3: Record the rule, and the reasoning that nearly went wrong

Extend `AGENTS.md`'s peer-floor section:

> A package this plugin lists in `dependencies` that `sanity` also depends on
> must have a range satisfiable by **every** `sanity` version the peer range
> allows — `sanity` pins its Sanity-scoped dependencies to exact versions, so a
> floor above the peer floor forces a second nested copy. Check the registry
> rather than assuming symmetry: `@sanity/validation` does not exist below
> 6.12 (it was split out of `sanity` then), which is why its range is
> `^6.12.0` while `@sanity/types` is `^6.10.0`.
>
> A duplicate copy is not automatically a bug, either. The `@sanity/ui`
> incident above was severe because v3 and v4 genuinely behaved differently.
> The three guards this plugin imports from `@sanity/types`
> (`isDocumentSchemaType`, `isImageSchemaType`, `isObjectSchemaType`) are pure
> duck-typing over plain objects and byte-identical across 6.10–6.13, so a
> second copy of *those* costs bundle size and nothing else. Check which kind
> you have before treating a duplicate as an emergency.

**Verify**: `grep -c "does not exist below" AGENTS.md` → at least 1.

## Test plan

No unit tests — this is a manifest change. The verification is Step 2's real
install, plus the existing suite passing unchanged.

Note for your report: `documentValidation.test.ts` stubs `validateDocument`, so
the suite passing is **not** evidence about cross-version behaviour. Only
Step 2's install check speaks to this plan's claim. Say so.

## Done criteria

ALL must hold:

- [ ] `package.json` has `@sanity/types: ^6.10.0` and `@sanity/validation: ^6.12.0`
- [ ] `peerDependencies.sanity` is **unchanged** at `^6.10.0` (`git diff package.json` shows no change to it)
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Step 2 was run for **both** `sanity@6.12.0` and `sanity@6.10.0`, and both `npm ls` outputs are recorded verbatim
- [ ] `AGENTS.md` carries the Step 3 text
- [ ] The commit message says this widens dependency ranges, not the peer range, and is not breaking
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 2 shows a nested copy **still** appears after widening. Then something
  else is forcing it and the diagnosis is incomplete.
- `verify-package` objects to either new range.
- `npm ls` reports an `ERESOLVE` on `sanity@6.10.0` + the plugin. That would
  mean the peer range is unsatisfiable for a reason this plan has not found.
- You find another dependency of this plugin that `sanity` also pins, with a
  floor above 6.10. Report it; the same rule applies but it is a separate
  change.
- You are tempted to raise `peerDependencies.sanity`. That was the first
  version of this plan's recommendation and the investigation removed the need
  for it. Do not reintroduce a breaking change.

## Maintenance notes

- A reviewer should ask for Step 2's two `npm ls` outputs. Everything else in
  this plan is a claim about npm resolution that only an install can settle.
- The asymmetric ranges (`^6.10.0` / `^6.12.0`) look like an oversight and are
  not. Step 3's `AGENTS.md` text is what stops someone "tidying" them into
  matching.
- Deferred: whether the plugin should support more than one Sanity minor at
  runtime. It assumes one today, and this change does not alter that — it only
  stops forcing a second copy where the studio already has one.
