# Plan 052: The assignee-suggestion lookup gives no feedback while loading or on failure, unlike its sibling snooze-suggestion

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on
> a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

Selecting a single row in the Open view can trigger two different
suggestion lookups, rendered side by side in `SelectionActions.tsx`: a
snooze-date suggestion and an assignee suggestion. The snooze one already
models its full lifecycle as a discriminated union
(`SnoozeSuggestionState`: `idle | loading | done | none | error`) and
renders all five states distinctly — including a "Suggesting…" button
while in flight and a plain error line if it fails. The assignee
suggestion has no such union at all — it's just
`{userId: string; reason: ...} | null`, and while its fetch
(`suggestAssigneeForRow` in `MergedList.tsx`) is in flight or if it
rejects, the UI renders exactly nothing, indistinguishable from "there was
never anything to suggest here." An editor gets zero feedback either way
for a real async read that can take time or fail. The fix mirrors the
snooze-suggestion's own already-proven shape onto the assignee one.

Note: `suggestAssignee` is documented (`src/inbox/types.ts`, around its
own doc comment) as a fast, non-billed "fact-based" lookup (reading
transaction history or `@mention` parsing), not a real AI/LLM network
call — this is presumably why the silent gap hasn't been noticed in
practice. It is still a real, verifiable UI gap for a genuine async read
with a silently-swallowed failure path.

## Current state

- `src/inbox/SelectionActions.tsx:21-26` — the pattern already proven for
  the sibling feature:
  ```ts
  export type SnoozeSuggestionState =
    | {status: 'idle'}
    | {status: 'loading'}
    | {status: 'done'; until: string; reason?: string}
    | {status: 'none'}
    | {status: 'error'}
  ```
  Rendered (lines 287-344): an idle trigger button, a disabled
  "Suggesting…" button while loading, a resolved date button with a
  tooltip once done, a muted "nothing to suggest" line for `none`, and a
  muted error line for `error` (reusing `t('assess.error')`'s copy — "Same
  treatment `assess.error`/`fix.error` already use elsewhere in this
  pane," per the existing comment there).

- `src/inbox/SelectionActions.tsx:86` — the assignee-suggestion prop's
  current, much narrower type:
  ```ts
  assigneeSuggestion?: {userId: string; reason: 'lastEditor' | 'mentioned'}
  ```

- `src/inbox/SelectionActions.tsx:356-374` — its only render branch,
  current code:
  ```tsx
  {assigneeSuggestion && onAssign && suggestedUser && (
    <Tooltip
      content={
        <Box padding={2}>
          <Text size={1}>{t(`action.assign.reason.${assigneeSuggestion.reason}`)}</Text>
        </Box>
      }
      placement="bottom"
    >
      <Button
        disabled={busy}
        fontSize={0}
        mode="bleed"
        onClick={() => onAssign(suggestedUser.id)}
        padding={1}
        text={t('action.assign.suggested', {name: suggestedUser.label})}
      />
    </Tooltip>
  )}
  ```
  No branch at all for loading or error/none — when the condition is
  false for any reason (still loading, or the fetch rejected), nothing
  renders.

- `src/inbox/MergedList.tsx:637-666` — the fetch itself, current code:
  ```tsx
  const [assigneeSuggestion, setAssigneeSuggestion] = useState<{
    userId: string
    reason: 'lastEditor' | 'mentioned'
  } | null>(null)

  useEffect(() => {
    if (!singleSelectedRow || !suggestAssigneeForRow) {
      setAssigneeSuggestion(null)
      return undefined
    }

    let cancelled = false
    setAssigneeSuggestion(null)

    suggestAssigneeForRow(singleSelectedRow.item)
      .then((result) => {
        if (!cancelled) setAssigneeSuggestion(result)
        return undefined
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('[sanity-plugin-structure-inbox] suggest-assignee failed', error)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ...
  }, [singleSelectedRow?.key])
  ```
  Important structural difference from the snooze one: this effect fires
  **automatically** on selection change (not from an explicit click, the
  way `handleSuggestSnooze` does). Confirm this is intentional and
  documented — `assigneeSuggestion`'s own doc comment in
  `SelectionActions.tsx` (around line 79-85) calls it "A fact-based
  alternative to picking a name," consistent with it being a cheap,
  non-billed lookup safe to run automatically, unlike the snooze
  suggestion which deliberately requires a click because it spends a real
  AI credit (see Plan 043). **Do not change this automatic-fetch
  behavior** — only add visible state for it, matching the snooze
  suggestion's *rendering* pattern, not its click-gated *triggering*
  pattern.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run src/inbox/MergedList.test.tsx` then `npx vitest run` (full) | all pass |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope**:
- `src/inbox/SelectionActions.tsx` — new status-union type, updated prop
  type, new render branches
- `src/inbox/MergedList.tsx` — the `assigneeSuggestion` state and effect
- `src/inbox/MergedList.test.tsx` and/or `src/inbox/SelectionActions.test.tsx`
  (whichever exists / is the right place — check both files first)
- `src/i18n/locales/en-US.ts` — one or two new keys only if needed (see
  Step 3; prefer reusing existing keys where the copy genuinely matches)

**Out of scope**:
- Do NOT change the automatic (non-click-gated) triggering behavior of
  the assignee-suggestion fetch — it stays automatic on selection change,
  matching its own documented "fact-based, cheap, not AI-billed" nature.
  Only the snooze suggestion is click-gated, and that is deliberate,
  documented, unrelated behavior (Plan 043) — do not make the assignee
  suggestion click-gated too.
- Do NOT touch `suggestAssigneeForRow`/`InboxSourceResult.suggestAssignee`
  itself (the actual lookup implementations in
  `unpublishedDrafts.ts`/`unresolvedComments.ts`) — this plan is purely
  about the consuming state/render code.
- Do NOT touch the snooze-suggestion code itself — it's the reference
  pattern, not something to change.

## Git workflow

- Branch: `advisor/052-assignee-suggestion-status-union`
- One commit: `fix: give the assignee-suggestion lookup visible loading/error/none states`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an `AssigneeSuggestionState` type, mirroring `SnoozeSuggestionState`

In `src/inbox/SelectionActions.tsx`, near `SnoozeSuggestionState`, add:
```ts
/**
 * `suggestAssignee`'s own state — unlike `SnoozeSuggestionState`, the
 * fetch behind this one fires automatically on selection change rather
 * than from a click (see `assigneeSuggestion`'s own doc comment below and
 * `MergedList.tsx`'s effect): it's a fast, non-billed fact lookup, not an
 * AI read that needs consent-gating. Only the *rendering* shape mirrors
 * the snooze suggestion, not the triggering.
 */
export type AssigneeSuggestionState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; userId: string; reason: 'lastEditor' | 'mentioned'}
  | {status: 'none'}
  | {status: 'error'}
```

**Verify**: `npm run typecheck` → exit 0 (new exported type, no consumers
yet).

### Step 2: Change the prop type and update `MergedList.tsx`'s state

In `src/inbox/SelectionActions.tsx`, change the prop:
```ts
assigneeSuggestion?: {userId: string; reason: 'lastEditor' | 'mentioned'}
```
to:
```ts
assigneeSuggestion?: AssigneeSuggestionState
```

In `src/inbox/MergedList.tsx`, change the `useState` and effect to track
the full union, mirroring `handleSuggestSnooze`'s own success/failure
handling exactly (same `cancelled`-flag pattern already in place here,
just also setting `status`):
```tsx
const [assigneeSuggestion, setAssigneeSuggestion] = useState<AssigneeSuggestionState>({
  status: 'idle',
})

useEffect(() => {
  if (!singleSelectedRow || !suggestAssigneeForRow) {
    setAssigneeSuggestion({status: 'idle'})
    return undefined
  }

  let cancelled = false
  setAssigneeSuggestion({status: 'loading'})

  suggestAssigneeForRow(singleSelectedRow.item)
    .then((result) => {
      if (!cancelled) {
        setAssigneeSuggestion(result ? {status: 'done', ...result} : {status: 'none'})
      }
      return undefined
    })
    .catch((error: unknown) => {
      console.error('[sanity-plugin-structure-inbox] suggest-assignee failed', error)
      if (!cancelled) setAssigneeSuggestion({status: 'error'})
    })

  return () => {
    cancelled = true
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unchanged reasoning from before this plan
}, [singleSelectedRow?.key])
```
Import `AssigneeSuggestionState` from `./SelectionActions` at the top of
`MergedList.tsx` (next to the existing `SnoozeSuggestionState` import).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Update the render branch and add loading/none/error branches

In `src/inbox/SelectionActions.tsx`, replace the single existing branch
(currently `{assigneeSuggestion && onAssign && suggestedUser && (...)}`)
with branches mirroring the snooze suggestion's own four visible states
(idle renders nothing extra — there is no separate "ask" trigger for this
one since it's automatic, so skip an idle branch entirely, matching the
fact that this feature has no click-to-start affordance):

```tsx
{assigneeSuggestion?.status === 'loading' && (
  <Button disabled fontSize={0} mode="bleed" padding={1} text={t('assignee.suggest.loading')} />
)}

{assigneeSuggestion?.status === 'done' && onAssign && suggestedUser && (
  <Tooltip
    content={
      <Box padding={2}>
        <Text size={1}>{t(`action.assign.reason.${assigneeSuggestion.reason}`)}</Text>
      </Box>
    }
    placement="bottom"
  >
    <Button
      disabled={busy}
      fontSize={0}
      mode="bleed"
      onClick={() => onAssign(suggestedUser.id)}
      padding={1}
      text={t('action.assign.suggested', {name: suggestedUser.label})}
    />
  </Tooltip>
)}

{assigneeSuggestion?.status === 'error' && (
  <Text muted size={0}>
    {t('assess.error')}
  </Text>
)}
```

Note: no branch for `status === 'none'` — unlike the snooze suggestion,
where "the AI genuinely had no date to suggest" is worth saying, an
assignee suggestion resolving to "nobody in particular" (`none`) is a
common, unremarkable outcome (most rows have no last-editor/mention
signal) — rendering nothing for `none` (same as today's effective
behavior) is the right call here, not a gap to fix. If you disagree after
reading the surrounding code, note your reasoning in the final report
rather than silently adding a `none` branch that wasn't asked for.

`suggestedUser` (used in the `done` branch) is derived elsewhere in this
file from `assigneeSuggestion` — find its existing derivation (search for
`suggestedUser` in `SelectionActions.tsx`) and update it to read from
`assigneeSuggestion.status === 'done' ? assigneeSuggestion.userId : ...`
instead of the old flat shape.

Add the new `assignee.suggest.loading` key to
`src/i18n/locales/en-US.ts`, near the existing `snooze.suggest.loading`
key, with a value like `'Checking…'` (matching that key's own ellipsis
convention).

**Verify**: `npm run typecheck` → exit 0. `npm run lint` → exit 0.

## Test plan

- Model new tests after this repo's existing snooze-suggestion tests in
  `src/inbox/MergedList.test.tsx` (search for `snoozeSuggestion` or
  `suggestSnooze` there for the exact mocking/assertion pattern — likely
  mocking `suggestAssigneeForRow` as a `vi.fn()` returning a controlled
  promise).
- New tests to add (in `MergedList.test.tsx`, alongside any existing
  assignee-suggestion coverage):
  - Selecting a row whose source offers `suggestAssignee` shows a loading
    indicator while the promise is pending.
  - A resolved suggestion still renders the existing "Suggest {{name}}"
    button (regression check: the already-working path must not break).
  - A rejected promise renders the error text (`assess.error`'s copy)
    instead of nothing.
- Verification: `npx vitest run src/inbox/MergedList.test.tsx` → all pass,
  including new tests. Then `npx vitest run` (full suite) → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0; new tests for the loading and error states
      of the assignee suggestion exist and pass
- [ ] `npm run build` exits 0
- [ ] `grep -n "assigneeSuggestion?: {userId" src/inbox/SelectionActions.tsx`
      returns no matches (confirms the old flat type is gone)
- [ ] `git status` shows only `src/inbox/SelectionActions.tsx`,
      `src/inbox/MergedList.tsx`, `src/i18n/locales/en-US.ts`, and the test
      file(s) changed
- [ ] `plans/README.md` status row for plan 052 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The current code in either file doesn't match the excerpts above (drift
  since this plan was written).
- `suggestedUser`'s existing derivation in `SelectionActions.tsx` turns
  out to be more involved than a simple lookup keyed by `userId` (e.g. it
  does something else you don't understand) — read it fully before
  changing it, and report if its logic doesn't obviously adapt to the new
  union shape.
- You find evidence the automatic (non-click) fetch trigger is actually
  meant to become click-gated too (e.g. a comment elsewhere suggesting
  this was already planned) — that would be a different, larger change;
  report it rather than doing it as part of this plan.

## Maintenance notes

- This plan intentionally leaves the *triggering* behavior (automatic on
  selection vs. click-gated) different between the two suggestion
  features — that's a real, documented, deliberate distinction (cost:
  free fact-lookup vs. billed AI read), not something to unify. A future
  reviewer should not "fix" this difference without re-reading why it
  exists.
- If a third per-selection suggestion feature is ever added to this
  pane, it should follow this same status-union rendering shape from the
  start rather than needing this same fix applied retroactively again.
