# Plan 006: Fix the public docs and identifiers the rename left behind

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 30e3782..HEAD -- src/plugin.tsx src/types.ts src/structure/resolveConfig.ts src/studio`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `30e3782`, 2026-09-09

## Why this matters

The plugin's single entry point carries a `@public` TSDoc example that does not
compile. It names an option (`widgets`) and a function (`recentlyEdited`) that
do not exist — both were removed when the plugin changed from a widget
dashboard to an inbox, and again when it was renamed from `structure-home` to
`structure-inbox`.

Because the tag is `@public`, this example is emitted into `dist/index.d.ts`
and is what a consumer's editor shows on hover. It is the first thing anyone
integrating this plugin reads, and it is wrong. The README has the correct
usage, so the two disagree.

Two more doc comments name options that never existed under those names, and
the `home` → `inbox` rename stopped short of the identifiers, leaving internal
code that reads as if it belongs to a different feature. That split vocabulary
is the first thing a maintainer returning to this repo has to reconcile.

None of this changes behaviour. It is cheap, and it is the kind of thing that
gets steadily more expensive to fix once the package is published and the
identifiers appear in stack traces people search for.

## Current state

**The shipped-wrong example**, `src/plugin.tsx:19-26`:

```
 * ```ts
 * export default defineConfig({
 *   plugins: [
 *     structureTool(),
 *     structureInbox({widgets: [recentlyEdited()]}),
 *   ],
 * })
 * ```
```

Confirmed present in the built artifact at `dist/index.d.ts:182`. Neither
`widgets` nor `recentlyEdited` exists: the option is `sources`
(`src/types.ts`), and `src/index.ts` exports `openTasks`, `unpublishedDrafts`
and `upcomingReleases`.

The correct usage, from `README.md`:

```ts
    structureInbox({
      sources: [openTasks(), unpublishedDrafts({olderThanDays: 7}), upcomingReleases()],
    }),
```

**Wrong i18n key**, `src/types.ts:22-24`:

```ts
  /**
   * Title shown on the Inbox pane and on its item in the root list.
   * Defaults to the localized `home.title`.
   */
  title?: string
```

The actual key is `inbox.title` — see `src/i18n/locales/en-US.ts` and
`src/structure/inboxNode.tsx:17`.

**Option that never existed**, `src/structure/resolveConfig.ts:4-8`:

```ts
/**
 * Fills in the defaults once, so nothing downstream has to repeat
 * `config.autoInject ?? true`.
 *
 * @internal
 */
```

`autoInject` was replaced by `showInList` before release; no such option exists
in `StructureInboxConfig`.

**Stale identifiers** (all `@internal`, so renaming is safe):

- `src/studio/createActiveToolLayout.tsx:27` — `StructureHomeActiveToolLayout`
- `src/studio/createActiveToolLayout.tsx:42` — passes `homeAvailable:`
- `src/studio/shouldRedirectToInbox.ts:6` — field `homeAvailable: boolean`
- `src/studio/shouldRedirectToInbox.ts:31` — `if (!decision.homeAvailable)`
- `src/studio/shouldRedirectToInbox.test.ts:8,26` — the test fixture uses it

Repo conventions:
- TSDoc on exported symbols, with `@public` or `@internal`. Prose explains
  *why*; match the voice of the surrounding comments.
- Conventional commits.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0              |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `src/plugin.tsx` (the TSDoc example only)
- `src/types.ts` (the `title` doc comment only)
- `src/structure/resolveConfig.ts` (the doc comment only)
- `src/studio/createActiveToolLayout.tsx`
- `src/studio/shouldRedirectToInbox.ts`
- `src/studio/shouldRedirectToInbox.test.ts`

**Out of scope** (do NOT touch):
- `INBOX_PANE_ID`'s **value** (`'structure-inbox'` in `src/constants.ts`) — it
  appears in URLs; changing it breaks existing bookmarks.
- The `structureInbox`, `inboxListItem` public export names — already correct.
- Any behaviour change whatsoever. If a rename would alter runtime behaviour,
  it is out of scope.
- `README.md` — it is already correct here.
- `package.config.ts`'s disabled TSDoc rules — see Maintenance notes.

## Git workflow

- Branch: `advisor/006-fix-stale-public-docs`
- Conventional commits, e.g. `docs: fix the public example left over from the widget API`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the public example

In `src/plugin.tsx`, replace `structureInbox({widgets: [recentlyEdited()]})`
with a call that actually compiles and matches the README:

```
 *     structureInbox({sources: [unpublishedDrafts()]}),
```

Keep the example minimal — one source is enough to show the shape. If you name
a source in the example, it must be one that `src/index.ts` exports.

**Verify**: `grep -rn "widgets\|recentlyEdited" src/` → no matches.

### Step 2: Fix the two wrong doc comments

- `src/types.ts`: change `` `home.title` `` to `` `inbox.title` ``.
- `src/structure/resolveConfig.ts`: change `` `config.autoInject ?? true` `` to
  an option that exists — `` `config.showInList ?? false` `` is the accurate
  example.

**Verify**: `grep -rn "home.title\|autoInject" src/` → no matches.

### Step 3: Finish the rename in identifiers

Rename, consistently across the three files that use them:

- `StructureHomeActiveToolLayout` → `StructureInboxActiveToolLayout`
- the `homeAvailable` field on `RedirectDecision` → `inboxAvailable`

Update the test fixture in `shouldRedirectToInbox.test.ts` to match, including
the test name at `:26` if it mentions "Home".

This is a pure rename: no logic changes, no changes to which value is passed.

**Verify**: `grep -rn "StructureHome\|homeAvailable" src/` → no matches, and
`npx vitest run` → all pass with the same test count as before.

### Step 4: Check for anything else the rename missed

Search the whole source tree for the old vocabulary and judge each hit. Some
uses of the word "home" may be legitimate English prose; identifiers and doc
references to a `home.*` key or a `Home` symbol are not.

```
grep -rni "\bhome\b" src/
```

Fix identifiers and stale references; leave ordinary prose alone. Report what
you left and why.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 5: Confirm the artifact is clean

Rebuild and check the shipped declarations no longer contain the bad example.

**Verify**: `npm run build` → `[success]`, then
`grep -c "widgets\|recentlyEdited" dist/index.d.ts` → `0`.

## Test plan

No new tests. This plan changes comments and internal names only; the existing
suite is the regression net, and it must pass **unchanged in count**.

`shouldRedirectToInbox.test.ts` is edited only to follow the field rename. If
you find yourself changing an assertion's *meaning*, you have gone beyond a
rename — stop.

**Verification**: `npx vitest run` → all pass, same number of tests as before
your change (34 at the time of writing).

## Done criteria

ALL must hold:

- [ ] `grep -rn "widgets\|recentlyEdited" src/` → no matches
- [ ] `grep -rn "home.title\|autoInject" src/` → no matches
- [ ] `grep -rn "StructureHome\|homeAvailable" src/` → no matches
- [ ] `npm run build` prints `[success]` and
      `grep -c "widgets\|recentlyEdited" dist/index.d.ts` → `0`
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0 with the same test count as before
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- A rename in step 3 would change anything a consumer can observe — these
  symbols are `@internal`, so if one turns out to be re-exported from
  `src/index.ts`, stop.
- The test count changes.
- `grep -rni "\bhome\b" src/` in step 4 surfaces something that looks like a
  behavioural dependency on the string `"home"` (a stored key, a URL segment,
  a saved preference) rather than a name. Report it; do not rename it.

## Maintenance notes

- The reason this drifted undetected: `package.config.ts` turns off API
  Extractor's TSDoc rules (`ae-missing-release-tag` and friends), so nothing in
  CI checks the public surface's documentation. Re-enabling at least
  `ae-missing-release-tag` would catch the next one — deliberately **not** done
  here because it may surface a batch of unrelated failures that belong in
  their own change.
- A reviewer should confirm the example in `plugin.tsx` compiles by pasting it
  into `test-studio/sanity.config.ts` mentally: every identifier in it must be
  exported from `src/index.ts`.
