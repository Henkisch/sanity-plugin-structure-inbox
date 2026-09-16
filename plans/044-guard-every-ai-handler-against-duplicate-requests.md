# Plan 044: A rapid double-click spends two real AI credits for one intended action

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2cbbb20..HEAD -- src/inbox/Inbox.tsx src/inbox/AskInbox.tsx src/inbox/InboxRow.tsx`
> If any of these changed since this plan was written, re-read them in full
> and compare against the excerpts below before proceeding — line numbers
> and exact guard logic may have shifted.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: cost / bug (found during this plugin's own AI-cost
  research session — see `project_ai_cost_research` in this session's own
  memory)
- **Planned at**: commit `2cbbb20`, 2026-09-16

## Why this matters

Six handlers in this codebase call an AI capability, and every one of
them shares the same gap: they track which request is the *most recent*
(via a `useRef` counter, from this session's own Plan 032) so a stale
**response** never overwrites a fresher one — but nothing stops a second
**request** from being sent in the first place. A rapid double-click (or
an impatient re-click before React has committed the `disabled` state
that would otherwise block it) fires the AI call **twice**, spending two
real credits — at a flat $0.05 each (confirmed against Sanity's own
billing docs and the maintainer's own usage dashboard during this
plugin's own cost research) — for what the editor experiences as one
click.

This is not theoretical. Plan 032's own regression test
(`src/inbox/Inbox.test.tsx`, `describe('Inbox handleSuggestTodos', ...)`)
already proves it empirically: it fires two clicks inside one `act()`
call and asserts `promptJsonMock` was called **twice**
(`expect(promptJsonMock).toHaveBeenCalledTimes(2)`) — direct evidence the
double-request already happens today, in the exact scenario this plan
fixes. Plan 032 only ever needed to prove the *displayed result* was the
second call's, not that only one call happened — this plan closes that
second, cost-relevant gap.

## Current state

All six call sites share the identical shape: bump a request-generation
ref, `setState({status: 'loading'})`, then **unconditionally** proceed to
call the AI — no check for "is a request already in flight" before doing
so.

- `src/inbox/Inbox.tsx:660-685` (`handleSummarize`):
  ```ts
  const handleSummarize = useCallback(async () => {
    const requestId = ++summarizeRequestRef.current
    setSummary({status: 'loading'})
    const digest = openRows /* ... */
    if (!agentClient) {
      if (requestId === summarizeRequestRef.current) setSummary({status: 'error'})
      return
    }
    try {
      const message = await agentClient.agent.action.prompt({ /* ... */ })
      if (requestId === summarizeRequestRef.current) setSummary({status: 'done', message})
    } catch (error: unknown) { /* ... */ }
  }, [agentClient, openRows, context])
  ```
- `src/inbox/Inbox.tsx` (`handleSuggestTodos`), same shape, its own
  `suggestTodosRequestRef`.
- `src/inbox/Inbox.tsx` (`handleFindContentGaps`), same shape, its own
  `findContentGapsRequestRef` — also now calls `getProjectDigest()`
  (Plan 042) before the AI call itself; that survey has its own separate
  TTL cache and is out of scope for this plan (a duplicate *survey* fetch
  isn't an AI-credit cost at all — see Plan 042's own reasoning — only
  the duplicate `promptJson`/`agent.action.prompt` call is).
- `src/inbox/AskInbox.tsx:65-88` (`handleSubmit`), same shape, its own
  `submitRequestRef`.
- `src/inbox/InboxRow.tsx:284-294` (`handleAssess`):
  ```ts
  const handleAssess = useCallback(() => {
    if (!onAssess) return
    setAssessment({status: 'loading'})
    onAssess(item)
      .then((assessment) => setAssessment({status: 'done', ...assessment}))
      .catch((error: unknown) => { /* ... */ })
  }, [onAssess, item, t])
  ```
  No request-generation ref at all here yet (unlike the four `Inbox.tsx`/
  `AskInbox.tsx` handlers, which already have Plan 032's own guard for
  display purposes) — this plan adds one for the same reason, plus the
  loading-guard this plan is actually about.
- `src/inbox/InboxRow.tsx:296-302` (`handleProposeFix`), same shape as
  `handleAssess`, same missing guard.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/Inbox.tsx` (`handleSummarize`, `handleSuggestTodos`,
  `handleFindContentGaps`)
- `src/inbox/AskInbox.tsx` (`handleSubmit`)
- `src/inbox/InboxRow.tsx` (`handleAssess`, `handleProposeFix`)
- Each file's own test file

**Out of scope**:
- `suggestSnooze` — covered separately by Plan 043 (a different problem:
  it fires with no click at all, not a double-fire on one click).
- `Inbox.tsx`'s new `getProjectDigest()` cache (Plan 042) — already has
  its own TTL-based dedup; a duplicate call there costs nothing in AI
  credits regardless (see "Current state" above).
- Any handler not listed above.

## Git workflow

- Commits land directly on `main`. Message style: `fix: stop a rapid
  double-click from sending the same AI request twice`.
- One commit per file, or one combined commit — executor's judgment; this
  is the same mechanical fix applied six times.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add an early-return guard to each of the three `Inbox.tsx` handlers

For each handler, check whether a request is already in flight **before**
bumping the ref and calling the AI — not after:

```ts
const handleSummarize = useCallback(async () => {
  if (summary.status === 'loading') return
  const requestId = ++summarizeRequestRef.current
  setSummary({status: 'loading'})
  // ...unchanged from here down...
}, [agentClient, openRows, context, summary.status])
```

Apply the identical pattern to `handleSuggestTodos` (`if (suggestions.status
=== 'loading') return`) and `handleFindContentGaps` (`if
(contentGapsResult.status === 'loading') return`). Add the checked
status to each handler's own dependency array (it wasn't there before,
since the handler never read it; it does now).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Same guard in `AskInbox.tsx`'s `handleSubmit`

```ts
const handleSubmit = useCallback(async () => {
  const trimmed = question.trim()
  if (!trimmed || !agentClient || result.status === 'loading') return
  // ...unchanged from here down...
}, [question, agentClient, rows, onSelect, context, getProjectDigest, onResultChange, result.status])
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Add the same guard, plus a request-generation ref, to `InboxRow.tsx`'s two handlers

These two don't have Plan 032's own ref pattern at all yet — add it here,
since the loading-guard alone isn't quite enough on its own (a `disabled`
prop already exists on their trigger `MenuItem`s and gates most real
double-clicks visually, but the guard inside the handler itself is what
actually stops a request under the same commit-timing race Plan 032's own
test proved reachable elsewhere in this codebase):

```ts
const assessRequestRef = useRef(0)

const handleAssess = useCallback(() => {
  if (!onAssess || assessment.status === 'loading') return
  const requestId = ++assessRequestRef.current
  setAssessment({status: 'loading'})
  onAssess(item)
    .then((assessment) => {
      if (requestId === assessRequestRef.current) setAssessment({status: 'done', ...assessment})
    })
    .catch((error: unknown) => {
      console.error('[sanity-plugin-structure-inbox] assess failed', error)
      const message = error instanceof AssessmentUnavailableError ? t('assess.unavailable') : t('assess.error')
      if (requestId === assessRequestRef.current) setAssessment({status: 'done', message})
    })
}, [onAssess, item, t, assessment.status])
```

Apply the identical pattern to `handleProposeFix` (its own
`proposeFixRequestRef`, guarding on `fix.status === 'loading'`).

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Tests

For at least one representative handler per file (`handleSuggestTodos` in
`Inbox.tsx`, already has test scaffolding from Plan 032; `handleSubmit` in
`AskInbox.tsx` if it has its own test file, otherwise via
`MergedList.test.tsx`; `handleAssess` in `InboxRow.tsx`), add a case
proving the underlying mock (`promptJsonMock`/an `onAssess` mock) is
called **exactly once** when the same trigger is clicked twice in quick
succession (inside one `act()` call, the same technique Plan 032's own
test already uses) — not twice. This is the inverse assertion of Plan
032's own existing test (which proves the *second* call's result wins);
this plan's new test proves there's only *one* call to begin with once
the fix lands.

**Verify**: `npm test -- Inbox` (and whichever other test files were
extended) → the new case(s) pass; temporarily revert Step 1-3's guard to
confirm the same test fails without it (proving the test actually
catches the regression), then restore the fix.

### Step 5: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New case per handled file: two rapid clicks on the same trigger result
  in exactly one underlying AI call, not two.
- Verification: `npm test` → all pass; each new case fails without the
  fix (confirmed by a temporary revert-and-restore during Step 4).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new case from Step 4 exists, passes, and
      was confirmed to fail without the fix
- [ ] `npm run build` exits 0
- [ ] All six handlers (`handleSummarize`, `handleSuggestTodos`,
      `handleFindContentGaps`, `AskInbox`'s `handleSubmit`, `InboxRow`'s
      `handleAssess`/`handleProposeFix`) return early when a request for
      that same capability is already in flight
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 044 updated

## STOP conditions

- A step's verification fails twice after a reasonable fix attempt.
- Any handler's own existing behavior turns out to depend on being
  re-entrant while loading (e.g., a legitimate reason a second click
  mid-flight should restart the read rather than be ignored) — if you
  find one, report it rather than guessing; this plan assumes "ignore a
  click while already loading" is correct for all six, matching how a
  disabled button already visually communicates that intent everywhere
  in this pane.

## Maintenance notes

Any future AI-triggering handler should check its own loading status
before firing, from the start — this is now the established pattern
alongside Plan 032's own request-generation-ref guard; the two work
together (this plan's guard stops the duplicate request, Plan 032's ref
stops a duplicate result from ever landing if one somehow still gets
sent).
