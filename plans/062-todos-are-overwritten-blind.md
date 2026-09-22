# Plan 062: Stop a second tab from silently deleting an editor's todos

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3893ae5..HEAD -- src/store/useTodos.ts src/store/todos.ts src/store/useTodos.test.tsx src/store/todos.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — this converts a blind write into a read-then-write, on the one store that holds content the editor typed. The retry semantics must not break the existing "leave it dirty on failure" behaviour.
- **Depends on**: none. (Plan 074 changes the same merge function for a different reason — if both are executed, do 062 first and re-read 074's excerpts.)
- **Category**: bug (data loss)
- **Planned at**: commit `3893ae5`, 2026-09-21

## Why this matters

Todos are the one thing in this plugin with **no document behind them**. Every
other source reflects something that exists in the dataset; a todo is a line an
editor typed into the pane, and the per-editor todos document is the only place
it lives.

That document is currently written blind. The persist effect serializes the
whole local list and `.set()`s it with no revision guard, no re-read, and no
merge. So: an editor with the Studio open in two tabs (or on a laptop and a
desktop) loses work. Whichever tab persists last replaces the other's entire
list — every todo added, edited or completed in the other tab since it loaded
is gone. No error, no conflict, nothing to recover from.

The same file already knows how to do this correctly. `transferTo` writes the
*recipient's* document with a fetch-merge-write loop, revision-guarded and
retried on conflict, under a comment explaining exactly why a blind `.set()`
would be wrong there. The sender's own document — the one with the editor's own
data in it — is on the blind path.

The inherited rationale for blind writes comes from `useDismissals.ts:25-34`,
which accepts last-write-wins because "losing one dismissal in that race is not
worth a merge protocol". That reasoning is sound for a *preference*. A todo is
not a preference, and `useTodos.ts:48-53` adopted the shape without
re-examining the premise.

## Current state

**The blind write** — `src/store/useTodos.ts:96-116`:

```ts
useEffect(() => {
  if (!dirtyRef.current || !documentId || !loadedRef.current) return

  const value = JSON.stringify(state)

  client
    .transaction()
    .createIfNotExists({_id: documentId, _type: TODOS_TYPE, [TODOS_FIELD]: value})
    .patch(documentId, (patch) => patch.set({[TODOS_FIELD]: value}))
    .commit({visibility: 'async'})
    .then(() => {
      dirtyRef.current = false
      return undefined
    })
    .catch((error: unknown) => {
      // Left dirty on purpose: the write never actually landed, so the next
      // time this effect runs for any reason, it retries this same value
      // instead of silently treating a failed write as done.
      console.error('[sanity-plugin-structure-inbox] could not save todos', error)
    })
}, [client, documentId, state])
```

Note the `.catch` behaviour — leaving `dirtyRef` set on failure is deliberate
and **must be preserved**.

**The merge function that already exists** — `src/store/todos.ts:149-162`.
`mergeTodos(a, b)` unions by id and lets the later `updatedAt` win. It is
currently called in exactly one place: the load path, `useTodos.ts:82`:

```ts
setState((current) => mergeTodos(parsed, current))
```

**The correct pattern, in the same file** — `src/store/useTodos.ts:143-192`
(`transferTo`). This is the shape to copy. Its own comment states the
reasoning:

```ts
// Fetch-merge-write, revision-guarded and retried on conflict rather
// than a blind `.set()` — two `transferTo` calls landing on the same
// recipient close together [...] would otherwise race [...] and a blind
// overwrite would silently discard it. A handful of attempts is enough
// for that realistic contention; failing after that is a real, surfaced
// error rather than an undetectable loss.
const MAX_ATTEMPTS = 5
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const existing = await client.fetch<{_rev: string; value: string | null} | null>(
    `*[_id == $id][0]{_rev, "value": ${TODOS_FIELD}}`,
    {id: toDocumentId},
  )
  const targetState = parseTodos(
    typeof existing?.value === 'string' ? JSON.parse(existing.value) : null,
  )
  const value = JSON.stringify(withTransferredTodo(targetState, item))

  try {
    if (existing) {
      await client
        .patch(toDocumentId)
        .ifRevisionId(existing._rev)
        .set({[TODOS_FIELD]: value})
        .commit({visibility: 'async'})
    } else {
      await client.create(
        {_id: toDocumentId, _type: TODOS_TYPE, [TODOS_FIELD]: value},
        {visibility: 'async'},
      )
    }
    // ... breaks out of the loop on success
```

Read the whole of `transferTo` (through its conflict-detection and its
`MAX_ATTEMPTS` exhaustion behaviour) before writing Step 1 — you are
generalising it, not re-inventing it.

**Repo conventions that apply here**:
- Error logging is `console.error('[sanity-plugin-structure-inbox] <lowercase message>', error)`. Match it.
- Store state shapes are parsed defensively through a `parse*` function (`parseTodos`, `src/store/todos.ts`) that tolerates unknown input. Never `JSON.parse` into trusted state without it.
- Writes use `{visibility: 'async'}`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npm run typecheck`                  | exit 0, no output   |
| Lint      | `npm run lint`                       | exit 0, no output   |
| This file's tests | `npx vitest run src/store/useTodos.test.tsx` | all pass |
| Full tests | `npm test`                          | all pass            |
| Build     | `npm run build`                      | `[success]`         |

## Scope

**In scope:**
- `src/store/useTodos.ts` — the persist effect, and a shared helper extracted from `transferTo` if that is the cleaner route
- `src/store/useTodos.test.tsx` — new tests

**Out of scope** (do NOT touch, even though they look related):
- `src/store/useDismissals.ts`, `src/store/useSnoozes.ts`, `src/store/useAssessments.ts` — their last-write-wins **is** the documented, accepted trade-off (`useDismissals.ts:25-34`). They hold preferences, not authored content. Do not "fix" them here; changing them is a separate decision with a different cost/benefit.
- `src/store/todos.ts`'s `mergeTodos` — call it, do not change its semantics. (Plan 074 is the one that revisits it.)
- The `dirtyRef`-left-set-on-failure behaviour — preserve it exactly.

## Git workflow

- Branch: `advisor/062-todos-blind-write`
- Conventional Commits. This is a `fix:`.
  Example from this repo's log: `fix: make a completed fix read as done, and confirm it somewhere that lasts`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the fetch-merge-write loop from `transferTo`

`transferTo` has the loop inline. Pull it into a module-scope helper in
`src/store/useTodos.ts` so the persist effect can use the same code rather than
a second copy of it (a second copy is how these two paths drifted apart in the
first place).

Target shape — take the *merge* as a parameter, because that is the only part
that differs between the two callers:

```ts
/**
 * Fetch-merge-write against one todos document, revision-guarded and retried
 * on conflict. Shared by `transferTo` (which merges a handed-off todo into
 * the recipient's list) and the persist effect (which merges this editor's
 * own local list over whatever else has landed since it loaded).
 *
 * A blind `.set()` here is data loss, not a lost preference: a todo is content
 * the editor typed, with no document behind it.
 */
async function writeTodosMerged(
  client: SanityClient,
  documentId: string,
  merge: (serverState: TodosState) => TodosState,
): Promise<void>
```

Keep `MAX_ATTEMPTS = 5` and the existing conflict-detection and exhaustion
behaviour byte-for-byte. Then rewrite `transferTo`'s body to call it with
`(serverState) => withTransferredTodo(serverState, item)`.

**Verify**: `npx vitest run src/store/useTodos.test.tsx` → all existing tests
still pass, including the transfer tests at `useTodos.test.tsx:172-240`. If any
transfer test changes behaviour, you have altered the loop — revert and redo.

### Step 2: Route the persist effect through it

Replace the blind transaction with:

```ts
writeTodosMerged(client, documentId, (serverState) => mergeTodos(serverState, state))
  .then(() => { dirtyRef.current = false; return undefined })
  .catch((error: unknown) => {
    // Left dirty on purpose — unchanged from before.
    console.error('[sanity-plugin-structure-inbox] could not save todos', error)
  })
```

Argument order matters: `mergeTodos(serverState, state)` with the local `state`
**second**. Read `mergeTodos`' own implementation at `src/store/todos.ts:149-162`
and confirm which side wins a tie before you commit to an order — state the
answer in your report.

Two properties to preserve, both load-bearing:
1. `dirtyRef.current` is cleared **only** after the write resolves.
2. `dirtyRef.current` stays set on failure, so the next effect run retries.

**Verify**: `npx vitest run src/store/useTodos.test.tsx` → all pass.

### Step 3: Confirm the effect cannot loop

The effect depends on `[client, documentId, state]`. It must not set `state` as
a consequence of running, or it re-runs forever. `writeTodosMerged` fetches and
merges *without* calling `setState` — confirm this is still true after Step 2
by reading your own code.

This repo has been taken down three times by render/update loops (see
`AGENTS.md`), so treat this as a real check, not a formality.

**Verify**: `grep -n "setState" src/store/useTodos.ts` → confirm no `setState`
call is reachable from the persist effect's own code path. State the result in
your report.

## Test plan

New tests in `src/store/useTodos.test.tsx`. Model them on the existing
transfer tests at `useTodos.test.tsx:172-240`, which already use a **stateful**
recipient stub — that is the quality bar, and you need the same kind of stub
here (one whose `fetch` returns what the previous `patch` wrote).

Cases to cover:

1. **The bug this plan fixes**: local state has todo A; the server document
   already has todo B written by another tab; after the persist effect runs,
   the written value contains **both**. Assert on the actual patched payload,
   not on a call count.
2. **Revision guard**: the write uses `ifRevisionId` with the `_rev` the fetch
   returned.
3. **Conflict retry**: first `patch.commit` rejects with a 409-shaped error,
   the second attempt succeeds, and the final written value still contains
   both todos.
4. **Attempts exhausted**: all attempts conflict → the promise rejects,
   `console.error` is called with the `[sanity-plugin-structure-inbox]` prefix,
   and `dirtyRef` is still dirty (assert indirectly: a subsequent effect run
   attempts the write again).
5. **A removal is not resurrected by the merge**: local state has had todo B
   removed and the server still has it. Document the actual behaviour you
   observe in the test name. **`mergeTodos` is a pure union, so B will come
   back** — that is a known, separate finding (plan 074, tombstones). Write the
   test to assert the *current* behaviour and add a code comment pointing at
   plan 074, rather than changing `mergeTodos` here.

**Verify**: `npm test` → all pass, including 5 new tests in this file.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0, with 5 new tests in `src/store/useTodos.test.tsx`
- [ ] `npm run build` exits 0 with `[success]`
- [ ] `grep -n "createIfNotExists" src/store/useTodos.ts` — the persist effect no longer uses the blind transaction (a `createIfNotExists` inside `writeTodosMerged`'s create branch is fine)
- [ ] `grep -c "ifRevisionId" src/store/useTodos.ts` → at least 1, and it is reachable from the persist path
- [ ] Your report states which side wins a tie in `mergeTodos`, and confirms no `setState` is reachable from the persist effect
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Extracting the loop from `transferTo` changes the behaviour of any existing
  transfer test. The extraction must be behaviour-preserving; if it cannot be,
  leave `transferTo` alone and write the persist path separately, and say so.
- You discover the persist effect can reach `setState`. That is a loop risk and
  needs review before it ships.
- `mergeTodos`' tie-breaking turns out to be ambiguous (e.g. missing
  `updatedAt` on one side). Report what you found; do not invent a rule.
- The fix appears to require touching `useDismissals.ts` / `useSnoozes.ts` /
  `useAssessments.ts`.
- A test for case 5 (removals) tempts you to change `mergeTodos`. That is plan
  074's job.

## Maintenance notes

- After this, `useTodos` is the only one of the four stores with a merge
  protocol. That asymmetry is **correct and deliberate** — todos are authored
  content, the other three are preferences. If someone later "harmonises" the
  four stores, this distinction is the thing not to lose. The doc comment on
  `writeTodosMerged` should say so; make sure it does.
- A reviewer should scrutinise: the argument order into `mergeTodos`, that
  `dirtyRef` is still cleared only on success, and that the retry loop cannot
  spin without bound.
- Deferred out of this plan: removals still resurrect through the union merge
  (plan 074), and the persist effect still has no user-facing error surface —
  only a console log, which is a repo-wide shape recorded in `plans/README.md`
  rather than specific to todos.
