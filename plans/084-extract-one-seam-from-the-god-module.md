# Plan 084: Take one seam out of `Inbox.tsx` — the AI-read handler, copied four times

> **Executor instructions**: Follow every step and its verification. On a STOP
> condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **This plan is deliberately narrow.** It is not "decompose `Inbox.tsx`". Do
> not widen it.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/inbox/Inbox.tsx src/inbox/MergedList.tsx src/inbox/AskInbox.tsx src/inbox/InboxRow.tsx`
> On a mismatch against the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED — `Inbox.tsx` sits directly on the render-identity invariant that has taken this pane down three times (`AGENTS.md`). The extraction must not change any `useItems` result identity or any rendering.
- **Depends on**: plan 066 (which adds the missing guards). Do 066 first, so this extracts a pattern that is already uniform.
- **Category**: tech-debt
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

`src/inbox/Inbox.tsx` is 1,924 lines, against a repo median around 200. The
`Inbox` component alone spans `:358-1924` — **1,566 lines in one function**,
with 13 `useState`, 18 `useCallback`, 16 `useMemo` and 6 `useRef`. Both it and
`MergedList.tsx` (1,321 lines) are past the point where an agent or a human can
hold them in context to make a safe change, which shows up in the plan log as
repeated manual conflict resolution in `Inbox.tsx` between sibling plans.

The clearest seam is the AI-read handler, and it is worth extracting because
the duplication has already cost something concrete. Three clusters in
`Inbox.tsx` are structurally identical — in-flight ref, request-id ref, the
handler, the `console.error`, the `finally` — copied verbatim including the
comment:

- `summarizeInFlightRef`/`summarizeRequestRef`/`handleSummarize` (`:686-727`)
- `suggestTodosInFlightRef`/`suggestTodosRequestRef`/`handleSuggestTodos` (`:742-790`)
- `findContentGapsInFlightRef`/`findContentGapsRequestRef`/`handleFindContentGaps` (`:805-852`)

The same pattern now exists in **seven** places across four files
(`AskInbox.tsx:74-75`, the three above, `InboxRow.tsx:308-309,332-333,365`,
`MergedList.tsx:664`) — and the seventh drifted: `MergedList.tsx:664` has the
request-id guard but no in-flight boolean, so a double-click bills twice. Plan
044 recorded the invariant as "All 6 handlers now use that pattern" while that
was already untrue.

So the cost of this duplication is not tidiness. It is that a cross-cutting
invariant has to be applied by hand in seven places and has already been missed.

## Current state

Read all three `Inbox.tsx` clusters in full before starting. They share:

1. two refs (in-flight boolean, request-id counter)
2. a `useState` holding `{status: 'idle' | 'loading' | 'done' | 'error', ...}`
3. a handler that: returns early if in-flight, sets in-flight, bumps the
   request id, sets `loading`, awaits, compares the request id before
   committing the result, logs `[sanity-plugin-structure-inbox] …` on error,
   and clears in-flight in `finally`

Two of the three also duplicate the same digest builder
(`openRows.slice(0, 30).map(...)`).

The doctrine comment at `Inbox.tsx:680-685` explains the ref-vs-state
distinction and belongs in the extracted hook's doc comment.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Relevant suites | `npx vitest run src/inbox/Inbox.test.tsx src/inbox/MergedList.test.tsx` | all pass |
| Full tests | `npm test` | all pass |
| Build | `npm run build` | `[success]` |

## Scope

**In scope:**
- `src/inbox/useAiRead.ts` (create) and `src/inbox/useAiRead.test.ts` (create)
- `src/inbox/Inbox.tsx` — migrate the three handlers
- `src/inbox/MergedList.tsx` — migrate `handleSuggestSnooze` (which closes the drift as a side effect)

**Out of scope** (do NOT touch, even though they look related):
- **`MergedList`'s 18 props and the `Inbox`-owned UI threaded through them.** That coupling is real but it is a *design question* (who owns the pane header), not a mechanical extraction, and the current arrangement is at least documented per-prop. Leave it.
- `InboxRow.tsx`'s two guards and `AskInbox.tsx`'s one. They are in different components with different state shapes; migrating them is a follow-up once the hook has proven itself on four call sites.
- Any change to rendering, to `useItems` results, or to what is passed to `MergedList`.
- Splitting `Inbox.tsx` further.

## Git workflow

- Branch: `advisor/084-useairead`
- Conventional Commits: `refactor:`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the hook, with the doctrine as its doc comment

```ts
/**
 * One AI read: its in-flight guard, its staleness guard, its state and its
 * error logging.
 *
 * The two refs guard different things, and conflating them is how this
 * pattern drifted in its seventh copy (`MergedList`'s snooze suggestion had
 * the second without the first, so a double-click billed twice):
 *
 * - the **in-flight** ref gates the *request*. A `status === 'loading'` state
 *   check is not enough: two clicks landing in the same React batch both run
 *   before React commits the first one's `setState`, so a state read is stale
 *   for both and both fire. A `ref.current` write is visible to the very next
 *   line of JS.
 * - the **request-id** ref decides which *response* is authoritative if one
 *   lands late.
 */
export function useAiRead<T>(run: () => Promise<T | null>): {
  state: AiReadState<T>
  start: () => void
  reset: () => void
}
```

`AiReadState<T>` is the `idle | loading | done | error` union the three
existing handlers already use — read them and unify the shape without changing
any of their rendered output.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Migrate one handler and diff the behaviour

Migrate `handleSummarize` only. Then run the existing tests that cover it
(`Inbox.test.tsx` — find them by searching for `summar`).

**Verify**: `npx vitest run src/inbox/Inbox.test.tsx` → all pass **with no test
changed**. If a test needs changing, the extraction is not behaviour-preserving
— STOP.

### Step 3: Migrate the remaining three

`handleSuggestTodos`, `handleFindContentGaps`, then
`MergedList.tsx`'s `handleSuggestSnooze`. The last one gains an in-flight guard
it did not have, which is the drift being closed — note it explicitly in your
report.

**Verify**: after each, the full suite passes with no test modified.

### Step 4: Prove the identity invariant is intact

This is the step that matters most, given `AGENTS.md`'s record.

**Verify**: 
- `npm run build` → `[success]`
- `grep -n "useAiRead" src/inbox/Inbox.tsx` → three call sites
- The hook's returned object must be referentially stable across renders when
  nothing changed. Assert it in `useAiRead.test.ts` (`rerender` and compare
  `result.current.start` by identity) — an unstable `start` passed down to
  `MergedList` is exactly the churn class that has crashed this pane.
- Report the line count of `Inbox.tsx` before and after (expect roughly −250).

## Test plan

New `src/inbox/useAiRead.test.ts`:

1. Two `start()` calls in one React batch → `run` called once.
2. A late response from a superseded request does not overwrite a newer one.
3. An error sets `status: 'error'` and logs with the
   `[sanity-plugin-structure-inbox]` prefix.
4. `run` resolving `null` produces whatever the existing handlers produce for
   that case (read them; do not invent).
5. The returned `start`/`reset` are referentially stable across a re-render.
6. `reset()` returns to `idle`.

Existing suites must pass **unchanged** — that is the real test of this
refactor.

**Verify**: `npm test` → all pass, 6 new tests, zero modified.

## Done criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0
- [ ] **No existing test was modified** (`git diff --stat` shows no changes to `Inbox.test.tsx` / `MergedList.test.tsx`)
- [ ] `src/inbox/useAiRead.ts` and its test exist, with 6 tests including the stability one
- [ ] Four call sites migrated (three in `Inbox.tsx`, one in `MergedList.tsx`)
- [ ] `MergedList.tsx`'s snooze suggestion now has an in-flight guard
- [ ] Your report gives `Inbox.tsx`'s line count before and after
- [ ] `git status` shows only in-scope files changed
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any existing test needs modifying. The extraction must be behaviour-preserving;
  a changed test means it is not, and the risk profile of this file does not
  allow "probably fine".
- The three handlers turn out to differ in a way the hook cannot absorb
  (e.g. one commits results differently). Then extract only the ones that
  genuinely match and report which did not — a hook with three special cases
  is worse than three copies.
- The returned callbacks cannot be made referentially stable. Do not ship an
  unstable callback into `MergedList`; report instead.
- You are tempted to also touch `MergedList`'s props. Read the out-of-scope
  list again.

## Maintenance notes

- After this, a fifth AI read uses the hook and inherits both guards. That is
  the entire point: the invariant becomes structural instead of remembered.
- `InboxRow`'s and `AskInbox`'s guards remain hand-rolled. Migrating them is a
  sensible follow-up **once** this hook has survived a release on four call
  sites — deliberately deferred rather than forgotten.
- A reviewer should check: no existing test changed, and `start` is stable.
- The larger decomposition of `Inbox.tsx` and `MergedList.tsx` remains open and
  is **not** recommended as one change. This plan removes ~250 lines and one
  duplicated invariant; the props coupling is the next decision, and it is a
  design conversation, not a refactor.
