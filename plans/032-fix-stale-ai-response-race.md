# Plan 032: Guard the pane-wide AI reads against a stale response overwriting a newer one

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- src/inbox/Inbox.tsx src/inbox/AskInbox.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

`Inbox.tsx`'s four pane-wide AI reads (`handleSummarize`,
`handleSuggestTodos`, `handleFindContentGaps`) and `AskInbox.tsx`'s
`handleSubmit` each set `{status: 'loading'}`, `await` an Agent Actions
call, and then unconditionally overwrite state with whatever comes back —
with no check that this is still the *most recent* request. If an editor
re-triggers one (a second click before the first resolves, e.g. after the
open-item list changed) and the two network calls resolve out of order,
the earlier click's response can land *after* and silently overwrite the
newer one — with nothing on screen indicating a race happened. The editor
just sees an answer that quietly doesn't match what they most recently
asked for.

## Current state

- `src/inbox/Inbox.tsx:615-637` (`handleSummarize`):
  ```ts
  const handleSummarize = useCallback(async () => {
    setSummary({status: 'loading'})
    const digest = openRows
      .slice(0, 30)
      .map((row) => `- ${row.item.title}${row.item.subtitle ? ` (${row.item.subtitle})` : ''}`)
      .join('\n')

    if (!agentClient) {
      setSummary({status: 'error'})
      return
    }

    try {
      const message = await agentClient.agent.action.prompt({
        instruction:
          (context ? `About this project: ${context}\n---\n` : '') +
          'Given this list of open inbox items, one per line:\n$items\n---\n' +
          'In two or three short sentences, say what looks most worth starting with first and why.',
        instructionParams: {items: digest || 'Nothing is open right now.'},
      })
      setSummary({status: 'done', message})
    } catch (error: unknown) {
      console.error('[sanity-plugin-structure-inbox] summarize failed', error)
      setSummary({status: 'error'})
    }
  }, [agentClient, openRows, context])
  ```
- `src/inbox/Inbox.tsx:655-684` (`handleSuggestTodos`) and
  `src/inbox/Inbox.tsx:700-734` (`handleFindContentGaps`) — same shape:
  `setX({status:'loading'})`, `await` (via `promptJson`, not
  `agent.action.prompt` directly, for these two), then `setX({status:
  'done', ...})` or `setX({status:'error'})` on catch, with no generation
  guard.
- `src/inbox/AskInbox.tsx:50-84` (`handleSubmit`) — same shape again, via
  `onResultChange({status:'loading'})` / `onResultChange({status:'done',
  ...})`, owned by a prop callback rather than local `useState`, but the
  same missing-guard problem.
- None of these four currently has any request-generation tracking. No
  existing test in `Inbox.test.tsx` (which today only tests
  `BoundedSection`/`BoundedSourceFeed`, per `grep -n "describe("
  src/inbox/Inbox.test.tsx`) or `MergedList.test.tsx` exercises this race.
- Test mocking pattern already established for this exact area, from
  `src/inbox/MergedList.test.tsx:15-38`:
  ```ts
  vi.mock('sanity', async (importOriginal) => {
    const actual = await importOriginal<typeof import('sanity')>()
    return {...actual, useRelativeTime: () => 'a while ago', useCurrentUser: () => null}
  })

  const {useAgentClientMock, promptJsonMock} = vi.hoisted(() => ({
    useAgentClientMock: vi.fn(() => ({}) as never),
    promptJsonMock: vi.fn(),
  }))

  vi.mock('../ai/useAgentClient', () => ({useAgentClient: useAgentClientMock}))
  vi.mock('../ai/promptJson', () => ({promptJson: promptJsonMock}))

  afterEach(() => {
    cleanup()
    promptJsonMock.mockReset()
  })
  ```
  `handleSummarize` calls `agentClient.agent.action.prompt(...)` directly
  (not through `promptJson`) — for testing it specifically, mock
  `useAgentClient` to return `{agent: {action: {prompt: vi.fn()}}}` rather
  than relying on `promptJsonMock`. `handleSuggestTodos`/
  `handleFindContentGaps`/`AskInbox`'s `handleSubmit` all go through
  `promptJson`, so `promptJsonMock` covers those three directly.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass, 367 + new tests |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/Inbox.tsx` (`handleSummarize`, `handleSuggestTodos`,
  `handleFindContentGaps`)
- `src/inbox/AskInbox.tsx` (`handleSubmit`)
- A new or extended test file covering at least one of the four (see Step
  3 — `handleSuggestTodos` is the specified representative case; the
  same fix pattern applies to the other three, but exhaustively testing
  all four is not required by this plan's own done criteria, only that
  all four have the fix applied)

**Out of scope**:
- `src/ai/promptJson.ts`, `src/ai/useAgentClient.ts` — the underlying
  request mechanism is unchanged; only the *handler's* own guard against
  applying a stale result changes.
- Any other `Inbox.tsx` state (`askResult`, selection state, etc.) beyond
  the four handlers named above.

## Git workflow

- Commits land directly on `main`. Message style: `fix: ignore a stale AI
  response when a newer request has already started`.
- One commit for all four handlers is fine, or one per file — executor's
  judgment.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add a generation-ref guard to each of the three `Inbox.tsx` handlers

For each of `handleSummarize`/`handleSuggestTodos`/`handleFindContentGaps`,
add a `useRef` counter, bump it at the start of the handler, capture the
value locally, and only apply the resolved/error state if the ref still
matches. Example for `handleSummarize` (apply the identical pattern to the
other two, adjusting only the state values each already sets):

```ts
const summarizeRequestRef = useRef(0)

const handleSummarize = useCallback(async () => {
  const requestId = ++summarizeRequestRef.current
  setSummary({status: 'loading'})
  const digest = openRows
    .slice(0, 30)
    .map((row) => `- ${row.item.title}${row.item.subtitle ? ` (${row.item.subtitle})` : ''}`)
    .join('\n')

  if (!agentClient) {
    if (requestId === summarizeRequestRef.current) setSummary({status: 'error'})
    return
  }

  try {
    const message = await agentClient.agent.action.prompt({
      instruction:
        (context ? `About this project: ${context}\n---\n` : '') +
        'Given this list of open inbox items, one per line:\n$items\n---\n' +
        'In two or three short sentences, say what looks most worth starting with first and why.',
      instructionParams: {items: digest || 'Nothing is open right now.'},
    })
    if (requestId === summarizeRequestRef.current) setSummary({status: 'done', message})
  } catch (error: unknown) {
    console.error('[sanity-plugin-structure-inbox] summarize failed', error)
    if (requestId === summarizeRequestRef.current) setSummary({status: 'error'})
  }
}, [agentClient, openRows, context])
```

Each handler needs its own separate ref (`summarizeRequestRef`,
`suggestTodosRequestRef`, `findContentGapsRequestRef`) — they're
independent races, not one shared counter.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Same guard in `AskInbox.tsx`'s `handleSubmit`

Same pattern, one `useRef` inside `AskInbox` itself, guarding the two
`onResultChange(...)` calls inside `handleSubmit` (the `{status:'loading'}`
call at the top does not need guarding — only the calls that happen after
the `await` do).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Add a regression test for `handleSuggestTodos`

In `src/inbox/Inbox.test.tsx` (extending the existing file — check its
current top-of-file setup first, since it may need the same `vi.mock`
block from `MergedList.test.tsx` added if not already present), render the
full `Inbox` component with a minimal `sources` array, resolve
`promptJsonMock` twice with different, distinguishable results but out of
order (make the *first* call's promise resolve *after* the second), invoke
the trigger twice in quick succession, and assert the final rendered
suggestion matches the **second** call's result, not the first.

`vi.fn()` mock implementations can be sequenced to resolve out of order
with two separately-controlled promises:
```ts
let resolveFirst!: (value: unknown) => void
let resolveSecond!: (value: unknown) => void
promptJsonMock
  .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
  .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
// trigger handleSuggestTodos twice here
resolveSecond({items: [{title: 'Second', reason: '...'}]})
resolveFirst({items: [{title: 'First', reason: '...'}]})
// assert only "Second" is on screen
```

**Verify**: `npm test -- Inbox` → the new test passes; without Step 1's
fix (temporarily revert it to confirm), the same test fails — confirming
the test actually catches the regression it's meant to.

## Test plan

- One new test in `src/inbox/Inbox.test.tsx`, per Step 3, proving
  `handleSuggestTodos` keeps the second (later) request's result even when
  the first request's promise resolves last.
- Verification: `npm test` → all pass, including the new test.
- Optional but encouraged: mirror the same test shape for
  `handleSummarize`/`handleFindContentGaps`/`AskInbox`'s `handleSubmit` if
  time allows — not required by this plan's done criteria.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; the new Step 3 test exists and passes
- [ ] `npm run build` exits 0
- [ ] All four handlers (`handleSummarize`, `handleSuggestTodos`,
      `handleFindContentGaps`, `AskInbox.tsx`'s `handleSubmit`) have a
      request-generation guard applied
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 032 updated

## STOP conditions

- Rendering the full `Inbox` component in a test requires Studio context
  this repo's existing test setup doesn't already provide, beyond what
  `MergedList.test.tsx`'s own mocks cover — if `Inbox.test.tsx` needs
  substantially more scaffolding than that file already has, STOP and
  report rather than building a large new test harness un-reviewed.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

If a fifth pane-wide AI read is ever added to `Inbox.tsx`, give it the same
generation-ref guard from the start — this is now the established pattern
for any `useState`-driven async AI call in this file.
