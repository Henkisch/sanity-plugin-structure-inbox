# Plan 068: Turn the four-times-repeated silent capability drop into a compile error

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/SourceFeed.tsx src/inbox/SourceFeed.test.tsx src/inbox/types.ts AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — a type-level guard plus a test fixture addition. Both additive.
- **Depends on**: none
- **Category**: tech-debt (a guard against a recurring bug)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`SourceFeed` is the single funnel every source's result passes through on its
way to `MergedList`. Adding a field to `InboxSourceResult` requires wiring it
in **three** places inside that one file, and if you miss any of them the field
silently does nothing — the capability ships, looks implemented, and is a dead
click.

This has happened four times. `SourceFeed.tsx`'s own comment names them:
`proposeFix`, `assigneeReadOnly`, `openDetail`, and `reopen` — the last of
which "silently made 'Mark as not done' a dead click the whole time" of its
first release.

Two mechanisms were supposed to prevent a fifth. Neither currently does:

1. **The type system cannot catch it.** `SourceReport extends Omit<InboxSourceResult, 'items' | 'loading'>`
   and every capability on `InboxSourceResult` is optional, so TypeScript
   happily accepts a report object with any subset of them present. There is no
   error when a field is forgotten, by construction.
2. **The guard test has already drifted.** `SourceFeed.test.tsx:28` is named
   "forwards every capability a source can return, not just the ones already
   wired up" and its fixture **omits `suggestSnooze` and `transfer`** — two
   real `InboxSourceResult` fields that `MergedList` actively reads. The test
   written to catch the next omission has itself fallen two fields behind.

And `AGENTS.md` does not mention this hazard at all, despite it meeting that
file's own stated bar exactly (silently breaks the Studio when violated). It
lives only in a code comment inside the file that has the problem.

Worth stating plainly, since it is the reassuring half: **`InboxSourceResult`
is safely extensible for integrators.** It is an interface of all-optional
members, so adding a field breaks no existing source. The hazard is entirely
internal to `SourceFeed`.

## Current state

**The destructure (place 1 of 3)** — `src/inbox/SourceFeed.tsx:69-86`:

```ts
const {
  loading,
  error,
  resolve,
  reopen,
  create,
  assess,
  proposeFix,
  assign,
  assigneeReadOnly,
  suggestSnooze,
  remove,
  update,
  openDetail,
  action,
  acknowledgable,
  transfer,
} = result
```

**The hazard, in its own words** — `src/inbox/SourceFeed.tsx:93-101`:

```ts
// This destructure is a hardcoded allowlist, not `...rest` — every new
// field `InboxSourceResult` gains (`proposeFix`, `assigneeReadOnly`,
// `openDetail`, and `reopen` itself — found missing here well after it
// shipped, silently making "Mark as not done" a dead click the whole
// time — all found this out the hard way) has to be added here,
// to `capabilities` below, and to its own `has*`/fingerprint entry in the
// effect's dependency list, or it never reaches `MergedList` at all: it
// silently drops out right here, at the one place every source's result
// funnels through before `onReport`.
```

**Place 2 of 3** — the `capabilities` ref, written twice
(`src/inbox/SourceFeed.tsx:120-153`: once as the `useRef` initial value, once
in the effect that refreshes it).

**Place 3 of 3** — the fingerprints and the effect dependency list
(`src/inbox/SourceFeed.tsx:155-194`).

**The drifted guard test** — `src/inbox/SourceFeed.test.tsx:40-54`. Its
`result: InboxSourceResult` literal lists `resolve`, `reopen`, `create`,
`assess`, `proposeFix`, `assign`, `assigneeReadOnly`, `remove`, `update`,
`openDetail`, `action`, `acknowledgable` — and **not** `suggestSnooze` or
`transfer`.

**Repo conventions that apply here**:
- `src/inbox/types.ts` is where the `InboxSourceResult` contract lives, heavily doc-commented per field. Any type-level helper this plan adds should live next to what it guards, i.e. in `SourceFeed.tsx`, not in `types.ts` — `types.ts` is public API surface and this is internal machinery.
- `AGENTS.md`'s own "Maintenance" section says to add genuinely new invariants of this shape to that file.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| Typecheck (the gate) | `npm run typecheck`                   | exit 0, no output   |
| Lint      | `npm run lint`                                    | exit 0, no output   |
| This suite | `npx vitest run src/inbox/SourceFeed.test.tsx`   | all pass            |
| Full tests | `npm test`                                       | all pass            |
| Build     | `npm run build`                                   | `[success]`         |

## Scope

**In scope:**
- `src/inbox/SourceFeed.tsx` — add the type-level guard
- `src/inbox/SourceFeed.test.tsx` — add the two missing fields to the fixture
- `AGENTS.md` — record the invariant

**Out of scope** (do NOT touch, even though they look related):
- `src/inbox/types.ts` — do not restructure `InboxSourceResult`. Collapsing 18 optional capabilities into a smaller bag would break every integrator, and each one is justified in its own doc comment. This plan guards the contract; it does not change it.
- Replacing the destructure with `...rest`. The allowlist is deliberate — `items`/`loading` must not flow through, and a spread would also forward anything a source invents. Keep the allowlist and make *forgetting* an entry fail the build.
- The fingerprint values themselves (e.g. `assign?.users.length`). Their lossiness is a separate finding (plan 087).

## Git workflow

- Branch: `advisor/068-capability-guard`
- Conventional Commits. `fix:` (it closes a bug class) or `chore:`. Not `docs(readme):` — per `release.config.cjs` that scope cuts a patch release.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Name the capability keys once, as a type

Add to `src/inbox/SourceFeed.tsx`, above the component:

```ts
/**
 * Every field of `InboxSourceResult` that is a *capability* — i.e. everything
 * except the data (`items`) and the load state (`loading`/`error`).
 *
 * This union exists so that forgetting to wire a new capability is a
 * `npm run typecheck` failure instead of a silent dead click. It has happened
 * four times (`proposeFix`, `assigneeReadOnly`, `openDetail`, `reopen` — the
 * last of which made "Mark as not done" inert for a whole release), because
 * every capability on `InboxSourceResult` is optional, so TypeScript accepts a
 * report with any subset of them present.
 */
type CapabilityKey = keyof Omit<InboxSourceResult, 'items' | 'loading' | 'error'>
```

Then assert that the `capabilities` ref covers all of them. The mechanism: give
the ref an explicit type that requires every key.

```ts
const capabilities = useRef<{[K in CapabilityKey]: InboxSourceResult[K]}>({
  resolve,
  reopen,
  // ...every key; omitting one is now an error
})
```

`{[K in CapabilityKey]: InboxSourceResult[K]}` is the important part: it is a
mapped type over the **required** key union, so a missing key fails even though
the source field is optional. (`Required<Pick<...>>` would *also* force the
values non-optional, which is wrong — the values genuinely can be `undefined`.)

Apply the same type to the effect that re-writes `capabilities.current`.

**Verify**: `npm run typecheck` → exit 0 (all keys are currently present in the
ref, so this should pass immediately). If it does not, you have found a
capability that is already unwired — **stop and report it**, because that is a
live bug this plan just discovered.

### Step 2: Prove the guard actually fires

Temporarily add a field to `InboxSourceResult` in `src/inbox/types.ts`:

```ts
/** @internal temporary guard check, remove */
__guardCheck?: () => void
```

Run `npm run typecheck`. It **must fail**, pointing at the `capabilities` ref
in `SourceFeed.tsx`.

Then remove the temporary field and confirm typecheck passes again.

Record both results in your report. This is the only evidence that the guard
works; without it the mapped type might be structurally satisfied by accident.

**Verify**: typecheck fails with the temporary field, passes without it, and
`git diff src/inbox/types.ts` is empty at the end.

### Step 3: Catch the test fixture up

Add `suggestSnooze` and `transfer` to the `result` literal in
`src/inbox/SourceFeed.test.tsx:40-54`, and extend the assertions so the test
actually checks they are forwarded (not merely present in the fixture).

Match the shapes from `src/inbox/types.ts`: `suggestSnooze` is a function;
`transfer` is `{users, toUser}`-shaped like `assign` — read the real types
rather than guessing.

Then make the fixture itself drift-proof: type it so a future missing field
fails. Since every field is optional, the same trick as Step 1 works:

```ts
const result: InboxSourceResult & {[K in CapabilityKey]: unknown} = { ... }
```

or, if exporting `CapabilityKey` from `SourceFeed.tsx` for the test is
unwelcome, state in the test's comment that the fixture must list every
capability and rely on Step 1's guard as the real backstop. Either is
acceptable — say which you chose and why.

**Verify**: `npx vitest run src/inbox/SourceFeed.test.tsx` → all pass, and the
test now asserts on `suggestSnooze` and `transfer` being forwarded.

### Step 4: Put the invariant in `AGENTS.md`

Add a section. It meets that file's stated bar: violating it silently breaks
the Studio.

> ## A new `InboxSourceResult` field must be wired in three places
>
> `SourceFeed.tsx` is the one funnel every source's result passes through
> before `onReport`. A new capability has to be added to the destructure, to
> the `capabilities` ref (twice — initial value and refresh effect), and to its
> own `has*`/fingerprint entry in the report effect's dependency list. Miss any
> and the capability ships as a dead click: this happened four times
> (`proposeFix`, `assigneeReadOnly`, `openDetail`, `reopen`) before the
> `CapabilityKey` mapped type made the first two a `npm run typecheck` failure.
> The fingerprint entry is still by hand — if a capability appears but never
> updates, that is where to look.

**Verify**: `grep -c "CapabilityKey" AGENTS.md` → at least 1.

## Test plan

- Step 3's fixture additions, with real assertions on the two new fields.
- Step 2's deliberate-failure check is the guard's own test, and it is manual
  by nature (a type error cannot be asserted from vitest without a
  type-testing dependency this repo does not have — do **not** add one for
  this).

**Verify**: `npm test` → all pass.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `grep -c "CapabilityKey" src/inbox/SourceFeed.tsx` → at least 2 (the type and its use)
- [ ] Step 2 recorded: typecheck **failed** with a temporary extra field, passed after removing it, and `git diff src/inbox/types.ts` is empty
- [ ] `src/inbox/SourceFeed.test.tsx`'s fixture includes `suggestSnooze` and `transfer`, with assertions on both
- [ ] `AGENTS.md` carries the new section
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's typecheck fails immediately. That means a capability is already
  unwired — a live dead-click bug. Report which one; it needs its own fix
  before this guard is added.
- Step 2's typecheck **passes** with the temporary field present. The guard is
  not working; fix the type rather than declaring victory.
- Making the fixture type-safe requires exporting something from
  `SourceFeed.tsx` that feels like API leakage. Prefer the comment-only route
  and say so.
- You are tempted to replace the destructure with `...rest`. Read the comment
  at `SourceFeed.tsx:93` again and report the disagreement rather than acting
  on it.

## Maintenance notes

- The guard closes two of the three places. **The fingerprint dependency entry
  is still manual**, and it has to be: it is a value judgement about what
  counts as a meaningful change, and an automatic dependency on the capability
  object itself would reinstate the render loop this whole mechanism exists to
  prevent (`SourceFeed.tsx:103-119`). So a capability can still appear and then
  never update. `AGENTS.md`'s new section says where to look; a reviewer should
  check the fingerprint entry when a capability is added.
- A reviewer should ask for Step 2's evidence. A mapped-type guard that is
  satisfied by accident looks identical to one that works.
