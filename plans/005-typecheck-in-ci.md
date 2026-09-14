# Plan 005: Typecheck in CI, and typecheck the test files too

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 30e3782..HEAD -- package.json .github/workflows/main.yml README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but see the note about plan 004 touching the same file)
- **Category**: dx
- **Planned at**: commit `30e3782`, 2026-09-09

## Why this matters

This repo publishes to npm from its CI workflow, and nothing in that workflow
runs a typecheck.

There is no `typecheck` script in `package.json` at all, so the command is
undiscoverable — the README's "Develop & test" section lists `npm test`,
`npm run lint` and `npm run format`, and a contributor has no way to learn that
`npx tsc --noEmit -p tsconfig.json` is the thing to run.

The only type checking that happens in CI is a side effect of `npm run build`
emitting declarations, and `tsconfig.dist.json` **excludes** every test file.
So all three test files — plus `package.config.ts` — are typechecked by nobody,
on any machine, unless a developer happens to run `tsc` by hand.

The cost is that a type error in a test file can sit on `main` indefinitely,
and the cheapest possible guard against shipping a broken artifact is simply
absent.

## Current state

`package.json` scripts, verbatim:

```json
  "scripts": {
    "build": "plugin-kit verify-package --silent && pkg-utils build --strict --check --clean",
    "dev": "npm run dev --workspace test-studio",
    "format": "oxfmt",
    "link-watch": "plugin-kit link-watch",
    "lint": "oxlint src",
    "prepublishOnly": "npm run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "watch": "pkg-utils watch --strict"
  },
```

There is no `typecheck` entry.

The CI build job, `.github/workflows/main.yml:44-58`:

```yaml
  build:
    runs-on: ubuntu-latest
    name: Lint & Build
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v4
        with:
          cache: npm
          node-version: lts/*
      - run: npm clean-install
        # Linting can be skipped
      - run: npm run lint --if-present
        if: github.event.inputs.test != 'false'
        # But not the build script, as semantic-release will crash if this command fails so it makes sense to test it early
      - run: npm run prepublishOnly --if-present
```

`tsconfig.json` (the one that *does* cover tests):

```json
{
  "extends": "./tsconfig.settings",
  "include": ["./src", "./package.config.ts"]
}
```

`tsconfig.dist.json` excludes them:

```json
  "include": ["./src"],
  "exclude": [
    "./src/**/__fixtures__",
    "./src/**/__mocks__",
    "./src/**/*.test.ts",
    "./src/**/*.test.tsx"
  ]
```

Baseline: `npx tsc --noEmit -p tsconfig.json` currently exits 0. The step you
add will be green on arrival.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                        | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0              |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `package.json` (scripts only)
- `.github/workflows/main.yml` (the `build` job only)
- `README.md` (the "Develop & test" script list)

**Out of scope** (do NOT touch):
- The `release` job in the workflow — plan 004 edits it. If plan 004 has
  already landed, leave its `--no-install` change alone; if it has not, do not
  pre-empt it.
- `tsconfig.dist.json` — its test exclusion is deliberate (tests must not ship
  in `dist`). The fix is to typecheck via `tsconfig.json`, not to change what
  the dist build compiles.
- Adding a `test-studio` build step to CI. That is worth doing but needs a
  dummy `SANITY_STUDIO_PROJECT_ID` and is deliberately deferred — see
  Maintenance notes.

## Git workflow

- Branch: `advisor/005-typecheck-in-ci`
- Conventional commits, e.g. `ci: run a typecheck in the build job`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a discoverable `typecheck` script

Add to `package.json` scripts, keeping the existing alphabetical ordering:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
```

**Verify**: `npm run typecheck` → exit 0, no output.

### Step 2: Run it in CI, before the build

In the `build` job of `.github/workflows/main.yml`, add a step after the lint
step and before `npm run prepublishOnly`:

```yaml
      - run: npm run typecheck --if-present
        if: github.event.inputs.test != 'false'
```

Match the surrounding style: `--if-present`, and the same `if:` guard the lint
step uses so a fast-tracked release can skip it the same way. Add a short
comment saying this covers the test files, which the dist build excludes.

**Verify**: `grep -n "typecheck" .github/workflows/main.yml` → shows the new
step positioned between lint and `prepublishOnly`.

### Step 3: Document it

In `README.md`, the "Develop & test" section ends with a line listing the other
scripts (`npm test`, `npm run lint`, `npm run format`). Add `npm run typecheck`
to that list.

**Verify**: `grep -n "typecheck" README.md` → at least one match.

### Step 4: Prove the gate actually catches something

A CI step that cannot fail is worse than no step, because it is believed. Prove
this one works:

1. Temporarily introduce a deliberate type error in a **test** file — e.g. in
   `src/store/dismissals.test.ts`, add `const bad: number = 'nope'` inside an
   existing test body.
2. Run `npm run typecheck` → it must **fail**, naming that file.
3. Run `npm run build` → note whether it passes. It is expected to pass,
   because `tsconfig.dist.json` excludes tests. This is the gap being closed.
4. Revert the deliberate error completely.

**Verify**: after reverting, `git diff --stat src/` shows no changes to any
test file, and `npm run typecheck` → exit 0.

## Test plan

No new unit tests — this is tooling. Step 4 *is* the test, and it must be
performed rather than assumed: it is the only thing that distinguishes a
working gate from a decorative one.

Record the result of step 4's point 3 in your report: it tells the maintainer
whether the dist build was ever a partial safety net.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exists and exits 0
- [ ] `.github/workflows/main.yml` `build` job runs `npm run typecheck` before
      `npm run prepublishOnly`
- [ ] `README.md` mentions `npm run typecheck`
- [ ] Step 4 was actually carried out, and the deliberate error is fully
      reverted (`git status` shows no modified test files)
- [ ] `npx vitest run` exits 0
- [ ] `npm run build` prints `[success]`
- [ ] Only the three in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `npm run typecheck` fails on the **unmodified** codebase. It passes at commit
  `30e3782`; a failure means the repo has drifted and you should report the
  errors rather than fixing them under this plan.
- In step 4, `npm run typecheck` *passes* despite the deliberate error — the
  script is pointed at the wrong tsconfig.
- The workflow file no longer matches the excerpt above.

## Maintenance notes

- `tsconfig.json` includes `./src` and `./package.config.ts`. Any new top-level
  TypeScript file (a script, a config) must be added to `include` or it will
  silently escape this gate — the same way test files escape the dist build.
- **Deferred, worth doing next**: CI never builds `test-studio`, so the
  "does the built artifact actually load in a real Studio" failure — which has
  bitten this repo once already, per the comment in `tsconfig.dist.json` about
  raw JSX shipping in `dist` — still has no automated detector. Adding
  `npm run build --workspace test-studio` with a dummy
  `SANITY_STUDIO_PROJECT_ID` would close it. Note that
  `test-studio/sanity.config.ts` uses a non-null assertion on that env var, so
  an unset value fails opaquely.
- A reviewer should confirm the new step's `if:` guard matches the lint step's,
  so skip-tests behaviour stays consistent.
