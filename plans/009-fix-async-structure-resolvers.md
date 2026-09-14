# Plan 009: Make async structure resolvers get the list item and the redirect

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8a13d7f..HEAD -- src/structure/wrapStructure.ts src/structure/inboxAvailability.ts src/studio/createActiveToolLayout.tsx src/studio/shouldRedirectToInbox.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 006 — **merged**, the field is already named `inboxAvailable`. Plan 007 (harness) is optional but preferred.
- **Category**: bug
- **Planned at**: commit `8a13d7f`, 2026-09-09 (refreshed after plans 001-006 merged)

## Why this matters

A Studio whose structure resolver is `async` — a common shape, since fetching
settings before building the list is ordinary — gets neither of this plugin's
two behaviours, and no warning that anything is wrong. The plugin simply
appears to do nothing.

There are two independent causes.

**The list item.** `wrapStructure` applies `addInboxListItem` only on the
synchronous branch. If the resolver returns a promise, `showInList: true` is
silently a no-op. The *sync* failure mode of the same option warns; the async
one does not, which is worse than either behaviour alone.

**The redirect.** For an async resolver, `setInboxAvailable(...)` runs inside a
`.then()` callback. The redirect effect reads availability at effect time and
is not subscribed to it — availability is not in the dependency array and
nothing re-triggers the effect. So the effect flushes before the promise
settles, reads `false`, bails, and never runs again.

The invariant recorded in `inboxAvailability.ts` ("by the time effects flush
this map is accurate") holds only for the synchronous path. The README
explicitly promises the async case works: "returning a node, a builder, or a
promise all work".

## Current state

`src/structure/wrapStructure.ts:112-117` — the branch where the list item is
lost:

```ts
    // A resolver is allowed to be async, and the common reason — awaiting a
    // client call before building the list — has nothing to do with us.
    if (isPromiseLike(base)) return base.then(withInbox)

    return withInbox(config.showInList ? addInboxListItem(S, base, config) : base)
```

Note `addInboxListItem` appears only on the second line — the sync path.

`src/structure/inboxAvailability.ts` — a module-level `Map<string, boolean>`
keyed by tool name, with `setInboxAvailable` / `isInboxAvailable` /
`resetInboxAvailability`. `withInbox` calls the setter (`wrapStructure.ts:92`,
`:101`, `:109`).

`src/studio/createActiveToolLayout.tsx:36-56` — the redirect effect:

```tsx
    useEffect(() => {
      const redirect = shouldRedirectToInbox({
        redirectOnLanding: config.redirectOnLanding,
        // Read at effect time, not render time: the structure resolver runs
        // during the render of the tool this component wraps, so by the time
        // effects flush it has already reported whether injection worked.
        inboxAvailable: isInboxAvailable(config.toolName),
        activeToolName,
        targetToolName: config.toolName,
        panes,
        intent,
      })

      if (!redirect) return

      navigate({panes: [[{id: INBOX_PANE_ID}]]}, {replace: true})
    }, [activeToolName, intent, navigate, panes])
```

Availability is read but is not a dependency.

(Plan 006 is merged: the field is `inboxAvailable` and the component is
`StructureInboxActiveToolLayout`. The excerpt above already reflects that.)

`shouldRedirectToInbox` already guards on `panes.length > 0`, which is what
makes a *late* redirect safe: if the editor navigated somewhere in the
meantime, the redirect stands aside.

Repo conventions:
- Pure predicates live beside their tests (`shouldRedirectToInbox.ts` +
  `.test.ts`); keep the predicate pure.
- Comments assert invariants — if you change when something is written, fix the
  comment that describes the ordering.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0              |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0              |
| Build     | `npm run build`                            | `[success]`         |
| Studio    | `npm run build && npm run dev`             | serves on :3333     |

## Scope

**In scope**:
- `src/structure/wrapStructure.ts`
- `src/structure/inboxAvailability.ts`
- `src/studio/createActiveToolLayout.tsx`
- `src/structure/wrapStructure.test.ts`
- `test-studio/sanity.config.ts` (add one workspace)

**Out of scope** (do NOT touch):
- `src/studio/shouldRedirectToInbox.ts` — the predicate is correct and tested;
  this plan changes *when* it is called, not what it decides.
- `src/inbox/**`, `src/store/**`.
- Re-keying availability by workspace as well as tool name. That is a real
  separate finding (multi-workspace cross-talk) but conflating it with this
  change makes both harder to review — see Maintenance notes.

## Git workflow

- Branch: `advisor/009-async-structure-resolvers`
- Conventional commits, e.g. `fix: honour showInList and the redirect for async structures`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Share the list-item injection across both branches

Move the `config.showInList ? addInboxListItem(S, base, config) : base` call so
both the sync and the async paths go through it — the cleanest shape is to do
it at the top of `withInbox`, so there is exactly one place that decides.

Take care that `addInboxListItem` receives the *resolved* node on the async
path, not the promise.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0; then add the test in
step 4 and confirm it passes.

### Step 2: Make availability observable

Turn `src/structure/inboxAvailability.ts` from a plain Map into a minimal
subscribable store, keeping the existing function names working:

- `setInboxAvailable(toolName, available)` — writes, and notifies subscribers
  **only when the value actually changes** (avoid waking every consumer on
  every structure re-resolve).
- `isInboxAvailable(toolName)` — unchanged, a synchronous read.
- `subscribeInboxAvailability(listener: () => void): () => void` — new.
- `resetInboxAvailability()` — unchanged; tests use it.

Keep it dependency-free — a `Set` of listeners is enough. Do not reach for a
state library.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0;
`npx vitest run src/structure/wrapStructure.test.ts` → still passes.

### Step 3: Subscribe the redirect effect

In `createActiveToolLayout.tsx`, read availability through
`useSyncExternalStore` so a late `true` re-renders the component and re-runs
the effect:

```tsx
const inboxAvailable = useSyncExternalStore(
  subscribeInboxAvailability,
  () => isInboxAvailable(config.toolName),
)
```

Pass that value into `shouldRedirectToInbox` instead of calling
`isInboxAvailable` inside the effect, and add it to the effect's dependency
array.

`getSnapshot` must return a **stable primitive** — a boolean is fine. Do not
return a new object from it; React will loop.

Then fix the comment that currently explains the effect-time read: it is no
longer accurate, and the accurate version explains why a subscription is
needed (an async resolver reports after the first effect flush).

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npm run lint` →
exit 0.

### Step 4: Add the async + `showInList` test

In `src/structure/wrapStructure.test.ts`, add a case combining the two
conditions that are each covered separately today but never together: an async
resolver **and** `showInList: true`. Assert the resolved list contains the
inbox item, the divider, and the original item — mirroring the existing
synchronous `showInList` test's assertions.

Add a second case asserting `isInboxAvailable(...)` becomes `true` after the
promise settles.

**Verify**: `npx vitest run src/structure/wrapStructure.test.ts` → all pass,
with 2 new tests.

### Step 5: Prove it in a real Studio

The redirect timing cannot be fully verified in jsdom — it depends on the
Studio's real render/effect ordering. Add a fourth workspace to
`test-studio/sanity.config.ts` with a deliberately delayed resolver:

```ts
structure: async (S) => {
  await new Promise((resolve) => setTimeout(resolve, 750))
  return S.list().title('Content').items(S.documentTypeListItems())
},
```

with `structureInbox({showInList: true, sources: [...]})`.

Then run `npm run build && npm run dev`, open that workspace's `/structure`,
and confirm: the URL becomes `/structure/structure-inbox` after the delay, the
Inbox pane renders, and the Inbox item appears in the root list.

Also re-confirm the existing guards still hold in that workspace: a deep link
such as `/structure/post` must **not** be redirected away after the delay.

**Verify**: both behaviours observed manually; record what you saw in your
report, including whether the redirect fired before or after the delay.

## Test plan

- `wrapStructure.test.ts`: async + `showInList` produces the item (step 4);
  availability flips to `true` after the promise settles.
- Manual, in `test-studio`: delayed resolver redirects on landing; a deep link
  in the same workspace is not hijacked (step 5).

A component test of `createActiveToolLayout` would be better than the manual
check, but it needs a router harness that plan 007 may not have built. If plan
007 produced one, add the test; otherwise the manual verification is the gate,
and say so in your report.

## Done criteria

ALL must hold:

- [ ] `addInboxListItem` is called on exactly one code path that both branches
      reach (`grep -n "addInboxListItem" src/structure/wrapStructure.ts` shows
      one call site)
- [ ] `subscribeInboxAvailability` exists and is used via `useSyncExternalStore`
      in `createActiveToolLayout.tsx`
- [ ] `npx vitest run` exits 0 with 2 new tests in `wrapStructure.test.ts`
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` prints `[success]`
- [ ] Step 5 performed in the test studio; the delayed-resolver workspace
      redirects, and a deep link in it does not
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `useSyncExternalStore`'s `getSnapshot` triggers React's "The result of
  getSnapshot should be cached" warning. That means the snapshot is not stable;
  fix the snapshot, and if you cannot, stop rather than suppressing it.
- The redirect starts firing in cases the existing tests say it should not
  (deep link, in-flight intent, wrong tool). Those guards are the whole safety
  story of this feature — a regression there is a STOP, not something to patch
  around.
- In step 5 the async workspace redirects *repeatedly*, or fights the editor's
  navigation. Report immediately; a redirect loop is worse than no redirect.
- You conclude availability must be re-keyed by workspace to make this work.
  That is out of scope — report it and stop.

## Maintenance notes

- **Deferred, related finding**: availability is keyed by tool name only, so
  two workspaces on one page that both use the default tool name `structure`
  share an entry. Today the `activeToolName !== targetToolName` guard masks it,
  but that is coincidence. Re-keying by `workspace + tool` is the fix; it was
  kept out of this plan so the subscription change stays reviewable on its own.
- A reviewer should check that `setInboxAvailable` notifies only on real
  changes — an unconditional notify turns every structure re-resolve into a
  re-render of the tool layout.
- The module-level store remains the coupling between `wrapStructure` (writer)
  and `createActiveToolLayout` (reader), with nothing in the type system
  connecting them. If this area is touched again, lifting it into React context
  is the structural fix.
