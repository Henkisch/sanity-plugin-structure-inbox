# Plan 074: Make a todo deletion actually stick

> **REWRITTEN 2026-09-22.** The original plan is stale in three ways and
> mis-framed the problem. Everything below the "## Original plan" heading is
> kept for the reasoning, not as instructions — **follow this header, not the
> steps below it.**
>
> **Steps 1 and 2 are already done.** Commit `fca9c0e` gave dismissals and
> snoozes tombstones (`dismissals.ts:26`, `snoozes.ts:39`, pruned on
> `DISMISSAL_TTL_DAYS = 90`). `plans/README.md` knows; this file did not. The
> original drift check would STOP immediately on line numbers that no longer
> point at the described code.
>
> **This was filed as a storage-policy decision. It is not.** It is a P1 data
> bug, and the "decision" was blocking the fix:
>
> - **Every todo deletion silently fails to persist.** Not a race. The persist
>   effect writes `mergeTodos(serverState, state)` on *every* persisted change
>   (`useTodos.ts:175`), re-fetching the server document first. `mergeTodos`
>   (`todos.ts:160-173`) is a pure union by id, so the server's still-present
>   copy is restored and written back. The repo already has a test that
>   **asserts** this — `useTodos.test.tsx:411`, "a locally-removed todo comes
>   back from the merge — known limitation, see plan 074".
> - **Every `transferTo` duplicates instead of moving** (unreported until now).
>   `useTodos.ts:220-226` writes the recipient's document, then calls
>   `withoutTodo` on the sender's local state — whose persist merge restores
>   the sender's copy. The todo ends up permanently on both lists.
>   `useTodos.ts:38-43`'s own doc comment promises "worst case it briefly
>   exists on both lists". That is false; it is permanent.
>
> **The growth worry that blocked this does not survive measurement.** A
> tombstone is 67–84 bytes and replaces a 113–246-byte entry that today never
> leaves the document, so tombstones *shrink* it. An active editor deleting
> ~200 todos/year costs ~15 KB/year. And a TTL would contradict
> `src/inbox/sources/todos.ts:82`'s `neverExpireDismissals: true`, whose reason
> (`dismissals.ts:99-110`) is that a todo has nothing else to mark it finished,
> so ageing its record out looks like data loss.
>
> **Do this instead**: an in-memory removed-id set (`useRef<Set<string>>`) in
> `useTodos`, subtracted in **both** merge call sites (`useTodos.ts:148` and
> `:175`). It fixes deletion and transfer with no stored-shape change, no
> back-compat risk, no growth and no TTL question. Its one remaining hole is a
> *second tab* that still holds the todo in its own state; a persisted
> tombstone (id → ISO map, no expiry) can be layered on later if that is ever
> actually reported.
>
> **The existing test at `useTodos.test.tsx:411` must be inverted**, not
> deleted: it currently asserts the bug. Rewrite it to assert the removal
> persists, and keep its comment history pointing here. Add a second test that
> `transferTo` leaves the sender's list without the item after the persist
> settles.
>
> **Test-suite warning**: `await waitFor(() => expect(client.fetch).toHaveBeenCalled())`
> does **not** wait for the merge — `fetch` was already called at mount, so
> such a test passes vacuously. Await the write instead.
>
> **Verification warning**: confirm `node_modules/.bin/tsc --version` prints a
> version before believing any green result. An empty `node_modules` makes
> `npm run typecheck` and `npm run lint` exit 0 having done nothing.

## Original plan

Kept for its reasoning about dismissals and snoozes, which shipped. Its
todos-specific framing is superseded above.

# (original) Give removals a tombstone, so "Mark as not done" stops silently undoing itself

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/store/dismissals.ts src/store/snoozes.ts src/store/todos.ts src/store/useDismissals.ts src/store/useSnoozes.ts src/store/useTodos.ts`
> On any mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — changes the stored document shape for three stores. Needs the versioned-read treatment the `parse*` functions already implement, or an old stored value stops parsing.
- **Depends on**: plan 062 (which rewrites `useTodos`' write path). Execute 062 first.
- **Category**: bug
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

All three merge functions are **pure unions**. They can express "this key
exists" but not "this key was deliberately deleted". So when a load resolves
*after* a local edit, the merge puts back whatever the editor just removed:

- a dismissal removed via "Mark as not done" reappears → the row drops out of
  Open again
- a snooze cleared via "Wake now" is re-applied
- a removed **todo** comes back — and that is a list entry, not just a flag

The window is short per mount, but every one of these hooks re-runs its load
whenever `documentId` changes (i.e. whenever `useCurrentUser()` settles late),
and the pane's hooks re-mount on every navigation into the Structure tool. The
failure is silent and reads as "the click didn't register".

The existing comment at `src/store/useDismissals.ts:107-121` reasons only about
the *additive* case ("would silently drop that tick") — the removal case was
never considered.

## Current state

**The merges, all unions**:
- `src/store/dismissals.ts:156-188` — `mergeDismissals` builds the union of both sides' source/item keys.
- `src/store/snoozes.ts:133-163` — same shape.
- `src/store/todos.ts:149-162` — `mergeTodos`, union by id, later `updatedAt` wins.

**The removals they cannot see**:
- `src/store/dismissals.ts:132-144` — `withoutDismissal`.
- the snooze and todo equivalents in their own files.

**Where the resurrection happens** — `src/store/useDismissals.ts:107-121`:
when the load resolves after a local edit (`hasLocalEditRef`), state becomes
`mergeDismissals(serverValue, current)`. A dismissal the editor removed is
still in `serverValue`, so the union restores it. Siblings:
`src/store/useSnoozes.ts:72`, `src/store/useTodos.ts:82`.

**The convention to follow**: each store has a `parse*` function that tolerates
unknown/older stored shapes. Any new field must be optional so an existing
stored document still parses — read `parseDismissals` before designing the
shape.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| These suites | `npx vitest run src/store/` | all pass |
| Full tests | `npm test` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope:** `src/store/dismissals.ts`, `src/store/snoozes.ts`,
`src/store/todos.ts`, their three `use*.ts` hooks, and all six test files.

**Out of scope:**
- `src/store/assessments.ts` — it is a cache keyed by `changedAt`, with no user-initiated removal, so it has no tombstone case. Confirm this before excluding it, and say so.
- The last-write-wins posture itself (`useDismissals.ts:25-34`). This plan does not add revision guards; it only makes removals expressible.

## Git workflow

- Branch: `advisor/074-tombstones`
- Conventional Commits: `fix:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Design the tombstone on one store first

Do `dismissals` alone, end to end, before touching the other two.

Shape: record a removal with a timestamp, so the merge can compare it against
the other side's entry the same way it already compares two entries:

```ts
/**
 * Keys the editor deliberately removed, with when. Without this the merge is
 * a pure union, so a load that resolves after a local removal puts the entry
 * straight back — "Mark as not done" silently undoing itself, which reads as
 * the click not registering.
 *
 * Optional so a document stored before this field existed still parses (see
 * `parseDismissals`).
 */
removed?: Record<string, string> // key → ISO timestamp
```

Then in `mergeDismissals`: an entry loses to a tombstone with a **later**
timestamp, and a tombstone loses to an entry with a later timestamp.

Prune tombstones on the same TTL the entries already use — otherwise the
document grows forever. Find that TTL in the existing prune logic and reuse it;
do not invent a second policy.

**Verify**: `npx vitest run src/store/dismissals.test.ts src/store/useDismissals.test.tsx` → all pass.

### Step 2: Confirm an older stored document still parses

**Verify**: add a test feeding `parseDismissals` a stored value with **no**
`removed` field (i.e. the current shape) and assert it parses to a valid state
with no tombstones. This is the backwards-compatibility gate; without it this
plan can wipe existing editors' state on upgrade.

### Step 3: Repeat for snoozes and todos

Same shape, same TTL reuse, same backwards-compatibility test each.

For todos, note the interaction with plan 062: after 062 the persist path also
merges, so the tombstone must be respected on **both** the load merge and the
persist merge. Check both call sites.

**Verify**: `npx vitest run src/store/` → all pass.

## Test plan

Per store (three sets):
1. **The regression**: local state has removed key X; the server value still
   has X; after the load merge, X is **absent**.
2. The inverse still works: the server has a key the local state has never
   seen → it is adopted (the additive case the current comment reasons about).
3. A tombstone older than a server entry loses (the entry was re-created after
   the removal).
4. Backwards compatibility: a stored value with no `removed` field parses.
5. Tombstones are pruned on the existing TTL.

Plus, for todos only: the tombstone is respected by the persist merge too.

**Verify**: `npm test` → all pass, ~16 new tests.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all exit 0
- [ ] Each of the three stores has a tombstone field, honoured by its merge and pruned on the existing TTL
- [ ] Each of the three has a "stored value without the new field still parses" test
- [ ] Test 1 was confirmed to **fail** before the change, per store (state this in your report)
- [ ] Your report confirms whether `assessments` needs a tombstone and why not
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- A store's existing prune logic has no single TTL to reuse. Report it; two
  policies in one document is how this drifts.
- The merge cannot distinguish "removed then re-added" from "never removed"
  without a timestamp the entries do not carry. Report the shape problem
  rather than guessing an ordering.
- Adding the field breaks an existing `parse*` test. That is the
  backwards-compatibility risk this plan is most exposed to — stop.
- Plan 062 has not landed and you are about to change `useTodos`' persist path.
  Do 062 first.

## Maintenance notes

- Three stores now share one pattern (entry + tombstone + TTL prune) in three
  copies. That is deliberate here — extracting it would couple three documents'
  shapes together — but a fourth store is the point at which to extract.
- A reviewer should check the backwards-compatibility test exists for each
  store. Without it, an upgrade silently resets editors' state.
- `useDismissals.ts:25-34`'s last-write-wins rationale remains true and is
  untouched: this plan makes removals *expressible*, not conflict-free.
