# Plan 088: Give the Node-only recipes a subpath that carries no ambient globals

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 7b3db76..HEAD -- package.json package.config.ts src/index.ts src/digest.ts src/staleEditorDocs.ts src/store/ README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW — additive. A new subpath export changes nothing for existing consumers; the barrel keeps working unchanged.
- **Depends on**: none. Follows plan 071, which shrank `dist/index.d.ts` but could not remove the ambient blocks.
- **Category**: dx / published surface
- **Planned at**: commit `7b3db76`, 2026-09-22

## First: the finding this plan replaces was wrong

`AGENTS.md` and `plans/README.md` both record that `dist/index.d.ts` ships
`interface SanityQueries {}` and call it "a real collision risk for any
consuming Studio that runs `sanity typegen`". **That claim is false, and it was
tested rather than reasoned about.**

Reproduction (run it yourself before trusting this plan — the commands are in
"Evidence commands" below): a scratch consumer with the plugin installed from
`npm pack`, a hand-written `sanity.types.ts` of the shape `sanity typegen`
emits, and a `client.fetch(q)` whose result must resolve to the registered
type.

- Without the plugin imported: compiles clean.
- With the plugin imported: **compiles clean, and the registry still resolves.**
  A deliberate `@ts-expect-error` on the wrong result shape fires, which is the
  proof that `fetch` resolved to `PostsQueryResult` rather than degrading to
  `any`.

That is exactly what the block's own doc comment predicts. `SanityQueries` is
declared **empty**, and TypeScript's interface merging is additive: an empty
contributor contributes nothing. The registry is deliberately a global rather
than a module augmentation *so that* it survives multiple copies of
`@sanity/client`. This plugin shipping one more empty copy is the designed
case, not a collision.

So: delete that claim. Do not build anything to "fix" `SanityQueries`.

## What is actually wrong

The same test found a real defect in a **different** ambient block, one nobody
had looked at: `interface File {}` (`dist/index.d.ts:906`).

In a consumer **without the DOM lib**, importing this plugin injects a global
`File` type that would not otherwise exist, and it is empty.

```
# no plugin import, lib: ["ES2022"]
src/x.ts(1,10): error TS2304: Cannot find name 'File'.      ← correct

# with `import type {InboxItem} from 'sanity-plugin-structure-inbox'`
src/x.ts(3,15): error TS2339: Property 'name' does not exist on type 'File'.
```

Two things go wrong there. `const f: File = …` now **compiles** where it should
have been rejected outright, and when something does fail, the error blames a
type the consumer never declared.

With the DOM lib present it is harmless — verified: real `File.name` and
`File.size` still resolve, because the empty interface merges into DOM's. **So
no Studio is affected.** Every Studio has the DOM lib.

The victims are precisely the consumers this README invites:

- `README.md:293` "Recipe: a digest outside the Studio" — `buildDigest`,
  `parseSnoozes`, explicitly pitched for a Sanity Function.
- `README.md:309` "Recipe: cleaning up after a departed editor" —
  `EDITOR_DOC_TYPES`, `findStaleEditorDocuments`.

Both tell the reader to import from `'sanity-plugin-structure-inbox'`, the
barrel, which is the only entry point there is. A Sanity Function is a Node
program with no DOM lib. It gets the ambient `File`, plus rxjs's
`SymbolConstructor.observable`, plus ~1,500 lines of React and Studio types, to
call four pure functions that import nothing.

## Why a subpath is the fix rather than suppressing the block

The modules these recipes use are already genuinely dependency-free — verified
by reading their imports:

| Module | Imports |
|---|---|
| `src/store/dismissals.ts` | *none* |
| `src/store/snoozes.ts` | *none* |
| `src/store/todos.ts` | *none* |
| `src/staleEditorDocs.ts` | *none* |
| `src/store/assessments.ts` | one constant + type-only |
| `src/digest.ts` | three type-only/local imports |

`src/inbox/types.ts` does not import `@sanity/client` (`grep -c` → 0), so
nothing in that set pulls the client graph. The ambient blocks arrive purely
because these symbols share a barrel with `assignmentStore`, `liveQuery`,
`useAgentClient` and the sources — the 26 files that do import
`@sanity/client`.

Stripping the block from the bundled `.d.ts` instead would be wrong: it is
`@sanity/client`'s own declaration, it is load-bearing for the parts of the
barrel that really do use the client, and editing another package's ambient
declaration out of a bundle is the kind of fix that breaks silently two
releases later.

## Current state

`package.json`'s exports map — there are exactly two entry points today:

```json
"exports": {
  ".": {"source": "./src/index.ts", "default": "./dist/index.js"},
  "./link-checker": {"source": "./src/link-checker.ts", "default": "./dist/link-checker.js"},
  "./package.json": "./package.json"
}
```

`./link-checker` is the exemplar to copy. Read `src/link-checker.ts` and how
`package.config.ts` handles it before adding a third — whatever that file does
to get its own entry is what the new one must do.

The symbols the new subpath must carry, all currently barrel-only
(`src/index.ts:46-60`):

`parseAssessments`, `AssessmentState`, `CachedAssessment`, `isDismissed`,
`parseDismissals`, `DismissalState`, `isSnoozed`, `parseSnoozes`,
`SnoozeState`, `parseTodos`, `TodoItem`, `TodosState`, `buildDigest`,
`DigestEditor`, `DigestSource`, `EditorDigest`, `EDITOR_DOC_TYPES`,
`findStaleEditorDocuments`, `EditorDocRef`.

## Evidence commands

Read-only, and worth running before you change anything — this plan's whole
premise is that the first finding was wrong and this one was tested.

```sh
# 1. build and pack the plugin
npm run build
npm pack --pack-destination /tmp/plan088

# 2. scratch consumer, OUTSIDE the repo
mkdir -p /tmp/plan088/c/src && cd /tmp/plan088/c
npm init -y && npm pkg set type=module
npm i typescript@5 @types/node /tmp/plan088/sanity-plugin-structure-inbox-*.tgz

# 3. tsconfig WITHOUT the DOM lib
cat > tsconfig.json <<'EOF'
{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"Preserve",
"moduleResolution":"bundler","strict":true,"noEmit":true,"skipLibCheck":true,
"typeRoots":[]},"include":["src"]}
EOF

# 4. with and without the import — the error differs
printf 'const f: File = {} as File\n' > src/x.ts
npx tsc -p tsconfig.json        # expect: TS2304 Cannot find name 'File'

printf "import type {InboxItem} from 'sanity-plugin-structure-inbox'\nconst f: File = {} as File\nexport type I = InboxItem\n" > src/x.ts
npx tsc -p tsconfig.json        # expect: clean — File now silently exists
```

Delete `/tmp/plan088` afterwards.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0, no output   |
| Lint      | `npm run lint`      | exit 0, no output   |
| Tests     | `npm test`          | all pass            |
| Build     | `npm run build`     | `[success]`         |

**Verification warning**: do not trust a worktree whose `node_modules` is
empty. `npm run typecheck` and `npm run lint` both exit 0 having done nothing
when the binaries are absent, which has already produced one false "verified"
report in this repo's history. Confirm `node_modules/.bin/tsc --version` prints
a version before you believe any green result.

## Scope

**In scope:**
- `package.json` — one new `exports` entry
- `package.config.ts` — the new entry, if `./link-checker` needs one there
- a new `src/<name>.ts` barrel re-exporting the dependency-free set
- `README.md` — both recipes' import lines, plus a note on why
- `AGENTS.md` and `plans/README.md` — delete the false `SanityQueries` claim

**Out of scope** (do NOT touch, even though they look related):
- **Removing anything from the main barrel.** These symbols stay exported from
  `.` as well. Moving them would be a breaking change for every existing
  consumer, and this plan's entire value is that it is additive.
- Editing, patching or post-processing `@sanity/client`'s ambient declarations.
- `SanityQueries`. It is not broken. See the top of this plan.
- The `SymbolConstructor.observable` block — it rides along on the same barrel
  and the same subpath fixes it; it needs no separate work.
- `inlinedDependencies` (hand-maintained; see `plans/README.md`).

## Git workflow

- Branch: `advisor/088-node-subpath`
- Conventional Commits. The new subpath is a `feat:` — it adds public API.
  The `AGENTS.md`/`plans/README.md` correction is a `docs:`.
  Per `release.config.cjs`, `docs(readme):` cuts a patch release; plain `docs:`
  does not. Choose the scope deliberately and say which you chose and why.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Name the subpath, and check the name against the recipes

Candidates: `./digest`, `./node`, `./documents`. Pick one and justify it in
your report — the README recipes are the readers who will type it, so it
should read naturally in `from 'sanity-plugin-structure-inbox/<name>'` next to
`buildDigest` and `findStaleEditorDocuments`.

Do not pick `./store`: `src/store/` also holds `useTodos`, `useDismissals` and
the other React hooks, so the name would promise more than the entry delivers.

**Verify**: your report states the chosen name and the one-line reason.

### Step 2: Add the entry point, copying `./link-checker`'s arrangement

Create the new `src/<name>.ts` re-exporting exactly the symbol list under
"Current state" — no more. Add the matching `exports` entry to `package.json`,
and whatever `package.config.ts` needs, following `./link-checker` exactly.

Every re-exported symbol needs a TSDoc release tag or the build fails
(`ae-missing-release-tag`, enabled in plan 067). They are `@public`.

**Verify**: `npm run build` → `[success]`, and `dist/<name>.d.ts` exists.

### Step 3: Prove the subpath is actually clean — this is the point of the plan

```sh
grep -c "declare global" dist/<name>.d.ts    # expect 0
grep -c "interface File" dist/<name>.d.ts     # expect 0
wc -l dist/<name>.d.ts                        # expect low hundreds at most
```

Then re-run the "Evidence commands" scratch consumer against the **new
subpath** instead of the barrel. The `File` misuse must go back to
`TS2304: Cannot find name 'File'`.

**Verify**: all three greps as stated, and the scratch consumer reports TS2304.
Record the `wc -l` number verbatim — it is the figure `AGENTS.md` will quote.

If `declare global` is **not** 0, stop. Something in the re-exported set pulls
the client graph after all, and the dependency table above is wrong. Report
which symbol, rather than trimming the list to make the number work.

### Step 4: Point the recipes at it

Update `README.md:300` and `README.md:315` to import from the subpath, and add
one short paragraph saying why it exists — a Node consumer wants none of the
Studio's types, and the barrel carries ambient DOM declarations that a
DOM-less `tsconfig` should not silently acquire.

Say plainly that the barrel still exports these too, so nobody reads this as a
migration they are forced to make.

**Verify**: `grep -c "structure-inbox/<name>" README.md` → at least 2.

### Step 5: Delete the false claim, and record what replaced it

In `AGENTS.md` (the "published type surface" section) and `plans/README.md`,
remove the assertion that `SanityQueries` is a collision risk. Replace it with
what the test showed:

> `dist/index.d.ts` ships three ambient `declare global` blocks from
> `@sanity/client`. Two are inert: `SanityQueries` is declared empty and
> TypeScript's interface merging is additive, so a consuming Studio's
> `sanity typegen` registry resolves identically with or without this plugin
> (tested: `client.fetch(q)` still resolves to the registered type, and a
> deliberately wrong result shape is still rejected). `SymbolConstructor.observable`
> is likewise additive.
>
> The third, `interface File {}`, is not inert for a consumer **without the DOM
> lib**: it injects an empty global `File` where there was none, so
> `const f: File = …` compiles when it should not. Studios are unaffected — they
> all have the DOM lib. Node consumers should import from
> `sanity-plugin-structure-inbox/<name>`, which carries no ambient blocks at all.

Keep the correction visible rather than silently editing the old sentence away:
the first finding was reasoned from the shape of the code and was wrong, and
that is the more instructive half.

**Verify**: `grep -c "collision risk" AGENTS.md` → 0.

## Test plan

The subpath's cleanliness is a property of the **build output**, so a unit test
cannot see it. Add a test that can:

1. A test asserting the new module re-exports every symbol in the list — so a
   later addition to the barrel that belongs in this set is noticed. Follow
   whatever pattern `src/link-checker`'s tests use, if any.
2. If the repo has no precedent for asserting on `dist/`, do **not** invent a
   test that shells out to a build. Record in your report that Step 3's greps
   are the only guard, and add them to `AGENTS.md` as a manual check instead.

**Verify**: `npm test` → all pass, existing tests unmodified.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0 — **with `node_modules/.bin/tsc --version` confirmed first**
- [ ] `grep -c "declare global" dist/<name>.d.ts` → 0
- [ ] The scratch consumer importing the **subpath** gets `TS2304` for `File`; importing the **barrel** still does not
- [ ] Every symbol in "Current state" is exported from both the barrel and the subpath (`git diff src/index.ts` shows no removal)
- [ ] Both README recipes import from the subpath, and the README says the barrel still works
- [ ] `grep -c "collision risk" AGENTS.md` → 0
- [ ] `plans/README.md` status row updated, and its `SanityQueries` entry corrected
- [ ] No files outside the in-scope list modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:

- Step 3's `declare global` count is not 0. The dependency analysis above is
  then incomplete — report which symbol drags the graph in.
- `@sanity/pkg-utils` cannot emit a second non-`link-checker` entry without
  config this plan has not anticipated. Report what it wants.
- You find yourself wanting to remove a symbol from the main barrel to make the
  split clean. That is breaking, and it is not what this plan is for.
- The `File` behaviour does not reproduce on your machine. Then it is
  version-specific — record your TypeScript and `@sanity/client` versions and
  report, rather than building a fix for something you could not observe.

## Maintenance notes

- The guard that matters long-term is Step 3's grep, not a unit test. If a
  future change makes `dist/<name>.d.ts` grow a `declare global`, something was
  added to the subpath barrel that does not belong there.
- This plan deliberately leaves the main barrel unchanged. A 3.0 could move
  these symbols out of it entirely; that decision belongs with the "Exports to
  reconsider in 3.0" list in `plans/README.md`, not here.
- The lesson worth keeping from the wrong first finding: "an ambient
  `declare global` in published types" is a *shape* that looks dangerous. Two of
  the three blocks are harmless and one is not, and only a compile against a
  real consumer distinguishes them. Reading the `.d.ts` cannot.
