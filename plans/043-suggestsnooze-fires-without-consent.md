# Plan 043: `suggestSnooze` spends a real AI credit on plain row selection — no click, no consent

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2cbbb20..HEAD -- src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx src/inbox/sources/unpublishedDrafts.ts src/inbox/types.ts`
> If any of these changed since this plan was written, re-read them in full
> and compare against the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (a deliberate, visible UX change — see "The trade-off,
  stated plainly" below; this is the one part of this plan that's a real
  judgment call, not just a bug fix)
- **Depends on**: none
- **Category**: cost / bug (this plugin's own AI-cost research session
  found it while auditing every AI call site for unconsented or duplicate
  spend — see `project_ai_cost_research` in this session's own memory)
- **Planned at**: commit `2cbbb20`, 2026-09-16

## Why this matters

Every other AI-powered feature in this plugin (`assess`, `proposeFix`,
Summarize, Suggest todos, Ask, Find content gaps) follows the same
pattern: an editor clicks something that says "AI" on it, *then* one
`agent.action.prompt` request fires. `suggestSnooze` is the one
exception. Confirmed directly in code:

- `MergedList.tsx:587-594` — `singleSelectedRow` is true the instant
  exactly one row is selected (any checkbox tick, in the Open view), and
  a `useEffect` (not a click handler) fires `suggestSnoozeForRow(item)`
  whenever that changes:
  ```ts
  const singleSelectedRow = view === 'open' && selected.length === 1 ? selected[0] : undefined
  const suggestSnoozeForRow = singleSelectedRow
    ? reports[singleSelectedRow.sourceName]?.suggestSnooze
    : undefined

  const [snoozeSuggestion, setSnoozeSuggestion] = useState<{until: string; reason?: string} | null>(null)

  useEffect(() => {
    if (!singleSelectedRow || !suggestSnoozeForRow) {
      setSnoozeSuggestion(null)
      return undefined
    }

    let cancelled = false
    setSnoozeSuggestion(null)

    suggestSnoozeForRow(singleSelectedRow.item)
      .then((result) => {
        if (!cancelled) setSnoozeSuggestion(result)
        return undefined
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('[sanity-plugin-structure-inbox] suggest-snooze failed', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [singleSelectedRow?.key, suggestSnoozeForRow])
  ```
- `unpublishedDrafts.ts:276-294` — `suggestSnooze`'s own body calls
  `promptJson(agentClient, ...)` — a real `client.agent.action.prompt`
  request, billed at a flat **1 credit ($0.05)** per call regardless of
  prompt size (confirmed against Sanity's own docs and the maintainer's
  own usage dashboard during this plugin's own AI-cost research —
  85 Agent Action requests billed at exactly $4.25, i.e. $0.05 each).
- `SelectionActions.tsx:261-280` — the suggestion, once resolved, renders
  immediately and unconditionally as a visible button in the selection
  bar — no menu to open first, nothing gating it on further intent.

**The consequence**: selecting exactly one `unpublishedDrafts` row for
*any* reason — to assign it, to delete it, to clear it, to look at its
title more closely before deciding what to do — silently spends a real
credit, every time, with zero indication to the editor that anything
billable just happened. This is the one AI feature in this plugin that
doesn't ask first.

## The trade-off, stated plainly

The current design is not accidental — it's a real, intentional UX
choice: showing the suggested date *immediately* on selection means an
editor snoozing a draft never has to click "ask AI" first and then wait;
the suggestion is often just already there. That's a genuinely nicer
flow than every other AI feature in this pane, which all require an
explicit click-then-wait.

This plan's fix (Step 1) trades that immediacy away in exchange for
never spending a credit without an explicit ask — matching how every
other AI feature here already works, and directly serving the
cost-consciousness this plugin's own maintainer has prioritized. If that
trade-off doesn't feel right once you're looking at the real UI, this is
a legitimate reason to stop and reconsider rather than plow through the
steps below — this is flagged as a STOP condition, not just a note, for
exactly that reason.

## Current state

- `src/inbox/MergedList.tsx:582-620` — the full `useEffect` quoted above,
  plus the `singleSelectedRow`/`suggestSnoozeForRow` derivations right
  before it.
- `src/inbox/SelectionActions.tsx:53` — `snoozeSuggestion?: {until:
  string; reason?: string}` prop; `:261-280` — where it renders (a
  `Tooltip`-wrapped button showing the suggested date, `onClick={() =>
  onSnoozeUntil(snoozeSuggestion.until)}`).
- `src/inbox/sources/unpublishedDrafts.ts:276-294` — `suggestSnooze`'s
  own implementation (quoted above) — the only source in this codebase
  that implements it (confirmed: `grep -rln "suggestSnooze"
  src/inbox/sources/*.ts` returns only this one file).
- `src/inbox/types.ts:388` — `InboxSourceResult.suggestSnooze?: (item:
  InboxItem) => Promise<{until: string; reason?: string} | null>` — the
  capability's own type. This plan does not need to change this type;
  the fix is entirely in *when* it's called, not its own shape.
- Every other AI capability in this codebase (`assess`, `proposeFix`,
  Summarize, Suggest todos, Ask, Find content gaps) is invoked from an
  explicit `onClick` handler — confirmed via this session's own AI-cost
  audit (`project_ai_cost_research` memory). `suggestSnooze` is the one
  exception.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/MergedList.tsx` (remove the automatic `useEffect`, replace
  with an on-demand fetch triggered by an explicit control)
- `src/inbox/SelectionActions.tsx` (the suggestion's own UI: an idle
  "suggest a time" trigger instead of an always-already-resolved value)
- `src/i18n/locales/en-US.ts` (new key(s) for the trigger's own label/
  loading state, following the existing `assess.*`/`fix.*` key
  conventions)
- `README.md` (wherever `suggestSnooze`/"AI-suggested snooze" is
  documented — update to describe the new click-triggered behavior)
- Each touched file's own test file

**Out of scope**:
- `src/inbox/sources/unpublishedDrafts.ts`'s own `suggestSnooze`
  implementation — unchanged; the fix is entirely about *when* it's
  called, not what it does or returns.
- `src/inbox/types.ts` — `InboxSourceResult.suggestSnooze`'s own type
  signature is unchanged.
- Any other AI capability — this plan is scoped to the one genuine
  outlier.

## Git workflow

- Commits land directly on `main`. Message style: `fix: make
  suggestSnooze click-triggered, not automatic on row selection`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Remove the automatic fetch; add an explicit trigger

In `MergedList.tsx`, delete the `useEffect` that calls
`suggestSnoozeForRow` automatically. Replace `snoozeSuggestion`'s own
state shape with the same `{status: 'idle' | 'loading' | 'done' |
'error'; ...}` pattern every other AI read in this pane already uses
(see `AskState` in `AskInbox.tsx` for the closest analog), and add a
handler that only runs on an explicit click:

```ts
type SnoozeSuggestionState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; until: string; reason?: string}
  | {status: 'none'}
  | {status: 'error'}

const [snoozeSuggestion, setSnoozeSuggestion] = useState<SnoozeSuggestionState>({status: 'idle'})
const snoozeSuggestionRequestRef = useRef(0)

// Reset to idle whenever the single-selected row changes, so a stale
// suggestion from a previous row never lingers under a new one — same
// reasoning the old effect's own `cancelled` flag already had, just
// without firing a request to go with it.
useEffect(() => {
  setSnoozeSuggestion({status: 'idle'})
}, [singleSelectedRow?.key])

const handleSuggestSnooze = useCallback(() => {
  if (!suggestSnoozeForRow || !singleSelectedRow) return
  const requestId = ++snoozeSuggestionRequestRef.current
  setSnoozeSuggestion({status: 'loading'})

  suggestSnoozeForRow(singleSelectedRow.item)
    .then((result) => {
      if (requestId !== snoozeSuggestionRequestRef.current) return
      setSnoozeSuggestion(result ? {status: 'done', ...result} : {status: 'none'})
    })
    .catch((error: unknown) => {
      console.error('[sanity-plugin-structure-inbox] suggest-snooze failed', error)
      if (requestId === snoozeSuggestionRequestRef.current) setSnoozeSuggestion({status: 'error'})
    })
}, [suggestSnoozeForRow, singleSelectedRow])
```

(The request-generation-ref guard here is the same pattern Plan 032
already established for every pane-wide AI read — apply it here too,
this being the first time this particular read gets one.)

Pass `snoozeSuggestion` (the new state) and `onSuggestSnooze:
handleSuggestSnooze` down to `SelectionActions` in place of the old
prop.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Update `SelectionActions`'s own UI

Replace the always-already-resolved suggested-date button with a small
trigger, matching `assess`/`fix`'s own "ask, then show" shape:

- `snoozeSuggestion.status === 'idle'`: render a plain ghost button/link,
  something like "Suggest a time" (new i18n key, e.g.
  `'snooze.suggest.ask'`), `onClick={onSuggestSnooze}`. Only rendered at
  all when `suggestSnoozeForRow`/its equivalent capability exists for the
  current single selection (same gating the old code already had via
  `singleSelectedRow`/`suggestSnoozeForRow` both being defined).
- `'loading'`: the same trigger, disabled, with a loading label (new key,
  e.g. `'snooze.suggest.loading'`).
- `'done'`: the existing suggested-date button (unchanged rendering),
  `onClick={() => onSnoozeUntil(snoozeSuggestion.until)}`.
- `'none'`: nothing to click (the AI genuinely had no date to suggest) —
  render a muted, non-interactive note (new key, e.g.
  `'snooze.suggest.none'`) rather than silently showing nothing, so a
  click that resolved to "no date" doesn't read as if the click never
  registered.
- `'error'`: same treatment `assess.error`/`fix.error` already use
  elsewhere in this pane (a plain error line, no retry button — see this
  session's own Plan 034 for why a fake retry button is worse than none).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Add the new i18n keys

In `src/i18n/locales/en-US.ts`, add (naming and exact wording is the
executor's own judgment, matching this file's existing tone):
`snooze.suggest.ask`, `snooze.suggest.loading`, `snooze.suggest.none`.
Reuse the existing `'assess.error'`-shaped generic error copy rather than
adding a fourth new key for the error case if one already fits.

**Verify**: `grep -n "snooze.suggest" src/i18n/locales/en-US.ts` → the new
keys are present.

### Step 4: Tests

Update `MergedList.test.tsx`'s own existing snooze-suggestion test(s) (if
any exist — `grep -n "suggestSnooze\|snoozeSuggestion"
src/inbox/MergedList.test.tsx` first) to reflect the new click-triggered
flow: selecting a row alone must **not** call the mocked
`suggestSnooze`; only clicking the new trigger does. Add a case
confirming a `'none'` result renders the new non-interactive note, and a
case confirming an error renders the plain error line.

**Verify**: `npm test -- MergedList` → all pass, including updated/new
cases.

### Step 5: Update `README.md`

Find and update whatever currently describes this feature (search for
"suggest" near "snooze") to describe the new click-triggered behavior —
state plainly that this used to fetch automatically on selection and now
requires an explicit click, if the README's own tone calls for
explaining the change; otherwise just describe current behavior
accurately.

**Verify**: manual re-read against the actual new code.

### Step 6: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- Updated: selecting a single suggestible row does not call
  `suggestSnooze` on its own (the core regression this plan exists to
  fix).
- New: clicking the new trigger calls `suggestSnooze` exactly once, and
  shows the resolved suggestion.
- New: a `null` result (nothing to suggest) renders the `'none'` state,
  not silence.
- New: a rejected promise renders the `'error'` state.
- Verification: `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new/updated case from Step 4 exists and
      passes
- [ ] `npm run build` exits 0
- [ ] Selecting a single row never calls `suggestSnooze` on its own —
      confirmed by the updated test, not just by reading the code
- [ ] `README.md` accurately describes the new click-triggered behavior
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 043 updated

## STOP conditions

- Having looked at the real UI, the immediacy trade-off (see "The
  trade-off, stated plainly" above) genuinely isn't worth it — the
  suggested-date button disappearing behind an extra click reads as a
  real regression, not just a minor cost/UX trade. If so, STOP and report
  back with what you saw rather than shipping a change the maintainer may
  want to reconsider; an alternative worth raising instead is a config
  option (default off) that opts a Studio *back into* the automatic
  fetch, rather than this plan's default of removing it outright.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

Any future `suggestSnooze`-shaped capability (or any new per-item AI
read) should be wired to an explicit click from the start, matching every
other AI feature in this pane — this plan exists specifically because
one wasn't.
