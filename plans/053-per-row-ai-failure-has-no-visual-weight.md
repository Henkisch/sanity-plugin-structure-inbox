# Plan 053: Per-row AI-read failures render identically to a normal result, using a treatment this file already has

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/inbox/InboxRow.tsx`
> If this file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

`InboxRow.tsx` already has a working, established pattern for giving a
per-row AI result visual weight by severity: when `handleAssess`'s
resolved assessment carries a `tone`, it renders inside a small
`<Card tone={assessment.tone}>` instead of plain text (see "Current
state"). But `handleAssess`'s own `.catch` handler — the path that runs
when the AI read itself fails — builds its fallback result with **no**
`tone` set at all, so a failed assessment renders through the exact same
plain-text branch as an ordinary, successful, untoned result. There is no
visual difference at all between "AI looked at this and had nothing
notable to say" and "AI could not be reached." Separately, `fix.status ===
'error'` (a different, adjacent per-row AI feature on the same row) also
renders as plain text with no color at all, unlike this file's own
tone-card pattern.

This is a narrow, safe fix precisely because the mechanism to reuse
already exists in this same file — no new component, no new visual
language, just applying the pattern `InboxRow.tsx` already built for
exactly this purpose to two paths that currently skip it.

## Current state

- `src/inbox/InboxRow.tsx:296-313` (approximate — search for
  `handleAssess`) — the assess handler's current code:
  ```tsx
  const handleAssess = useCallback(() => {
    if (!onAssess || assessInFlightRef.current) return
    assessInFlightRef.current = true
    const requestId = ++assessRequestRef.current
    setAssessment({status: 'loading'})
    onAssess(item)
      .then((assessment) => {
        assessInFlightRef.current = false
        return requestId === assessRequestRef.current ? setAssessment({status: 'done', ...assessment}) : undefined
      })
      .catch((error: unknown) => {
        assessInFlightRef.current = false
        console.error('[sanity-plugin-structure-inbox] assess failed', error)
        const message = error instanceof AssessmentUnavailableError ? t('assess.unavailable') : t('assess.error')
        return requestId === assessRequestRef.current ? setAssessment({status: 'done', message}) : undefined
      })
  }, [onAssess, item, t])
  ```
  Note precisely: the `.catch` branch sets `{status: 'done', message}` —
  no `tone` field — so it is genuinely indistinguishable, at render time,
  from a real successful assessment that simply had no tone to report.

- `src/inbox/InboxRow.tsx:410-425` (approximate — search for
  `assessment.status === 'done'`) — the render branch this feeds into,
  current code:
  ```tsx
  {assessment.status === 'done' &&
    (assessment.tone ? (
      // A tone-carrying assessment gets a small coloured card — `Text`
      // itself has no `tone` prop in this design system, and this is the
      // one place an assessment's own severity actually shows up (never
      // the row's own tone, never the sort — see `InboxAssessment`'s own
      // doc comment on why those stay separate).
      <Card padding={1} radius={2} tone={assessment.tone}>
        <Text muted size={0}>
          {assessment.message}
        </Text>
      </Card>
    ) : (
      <Text muted size={0}>
        {assessment.message}
      </Text>
    ))}
  ```
  This is the mechanism to reuse — it already exists, already works,
  already has a doc comment explaining its own purpose. The `.catch`
  handler above just never sets the `tone` that would route a failure into
  it.

- `src/inbox/InboxRow.tsx` — `FixState`'s type (search for `type
  FixState`):
  ```ts
  type FixState =
    | {status: 'idle'}
    | {status: 'loading'}
    | {status: 'none'}
    | {status: 'proposed'; proposal: FixProposal}
    | {status: 'applying'; proposal: FixProposal}
    | {status: 'applied'}
    | {status: 'error'}
  ```
  and its `error` render branch (search for `fix.status === 'error'`),
  current code:
  ```tsx
  {fix.status === 'error' && (
    <Text muted size={0}>
      {t('fix.error')}
    </Text>
  )}
  ```
  Unlike `assessment`, `FixState` has no `tone` field to plumb through —
  this branch needs its own, separately-added `Card tone="critical"`
  wrapper (there is no existing tone-carrying data to reuse here, so this
  one is a direct visual addition, not a "just set an existing field"
  fix).

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run src/inbox/InboxRow.test.tsx` then `npx vitest run` (full) | all pass |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope**:
- `src/inbox/InboxRow.tsx` — the `handleAssess` `.catch` handler (add
  `tone: 'critical'`) and the `fix.status === 'error'` render branch (wrap
  in a critical-toned `Card`, matching the assessment pattern)
- `src/inbox/InboxRow.test.tsx` (add tests)

**Out of scope**:
- Do NOT touch `fix.status === 'none'` — that's a normal, unremarkable
  outcome ("no good match found"), not a failure; it correctly stays plain
  text. Only `fix.status === 'error'` (an actual failure, parallel to
  assess's) gets the new treatment.
- Do NOT touch the pane-level AI-read cards in `Inbox.tsx` (Summarize/
  Suggest todos/Find content gaps/Ask) — those already have full critical-
  card treatment; this plan is only about the per-row (`InboxRow.tsx`)
  reads.
- Do NOT change `assessInFlightRef`/`assessRequestRef`'s own same-tick
  race-guard logic (the ref-based in-flight guards documented at length
  just above `handleAssess`) — this plan only adds one field (`tone`) to
  the object already being constructed inside the existing `.catch`
  handler; do not restructure the handler itself.
- Do NOT add a `tone` field to `FixState`'s type — `fix`'s error state
  carries no other data (`{status: 'error'}`), so there's nothing to
  plumb; just hardcode `tone="critical"` on the wrapping `Card` at the
  render site, matching how the assessment path's `Card` reads its own
  (variable) tone.

## Git workflow

- Branch: `advisor/053-per-row-ai-failure-visual-weight`
- One commit: `fix: give per-row assess/fix failures the same tone-card treatment successful tone results already get`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Give the assess failure a `tone`

In `handleAssess`'s `.catch` handler, change:
```tsx
return requestId === assessRequestRef.current ? setAssessment({status: 'done', message}) : undefined
```
to:
```tsx
return requestId === assessRequestRef.current
  ? setAssessment({status: 'done', message, tone: 'critical'})
  : undefined
```
No render-code change needed for this one — the existing `assessment.tone
? <Card tone={assessment.tone}>...` branch already handles it correctly
once `tone` is set.

**Verify**: `npm run typecheck` → exit 0 (confirms `tone: 'critical'` is a
valid value for whatever type `assessment`'s `tone` field expects — it
should be, since it's the same `InboxItem['tone']`-shaped field the
successful path already sets from real AI output).

### Step 2: Wrap the fix-error branch in a critical-toned `Card`

Change:
```tsx
{fix.status === 'error' && (
  <Text muted size={0}>
    {t('fix.error')}
  </Text>
)}
```
to:
```tsx
{fix.status === 'error' && (
  <Card padding={1} radius={2} tone="critical">
    <Text muted size={0}>
      {t('fix.error')}
    </Text>
  </Card>
)}
```
matching the assessment branch's exact `Card` prop shape (`padding={1}
radius={2}`).

**Verify**: `npm run typecheck` → exit 0. `npm run lint` → exit 0.

## Test plan

- Model new tests after this repo's existing `InboxRow.test.tsx` tests for
  `handleAssess`/`handleProposeFix` (search for `assess.error` or
  `fix.error` in that file for the existing mocking pattern — likely
  mocking `onAssess`/`onProposeFix` as a `vi.fn()` that rejects).
- New tests:
  - A rejected `onAssess` call renders the resulting message inside a
    `Card` with a critical tone (assert via whatever this repo's existing
    tests use to check tone — e.g. a `data-ui="Card"` ancestor with the
    right tone attribute/class, following the exact pattern any existing
    test elsewhere in this repo already uses for asserting a `Card`'s
    `tone` prop; if none exists, check the DOM structure directly — a
    `Card`, not a bare `Text`, now wraps the message).
  - A rejected `onProposeFix` call (or a fix-error state reached however
    this file's existing tests already trigger it) renders `fix.error`'s
    message inside a critical-toned `Card`, not bare text.
  - Regression check: a *successful* assess with no tone (or with a
    non-critical tone) still renders exactly as before — don't let the new
    fallback tone leak into the success path.
- Verification: `npx vitest run src/inbox/InboxRow.test.tsx` → all pass,
  including new tests. Then `npx vitest run` (full suite) → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0; new tests confirming both failure paths
      now render inside a critical-toned `Card` exist and pass
- [ ] `npm run build` exits 0
- [ ] `grep -n "setAssessment({status: 'done', message})" src/inbox/InboxRow.tsx`
      returns no matches (confirms the old, tone-less fallback is gone)
- [ ] `git status` shows only `src/inbox/InboxRow.tsx` and
      `src/inbox/InboxRow.test.tsx` changed
- [ ] `plans/README.md` status row for plan 053 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either excerpt in "Current state" doesn't match the live code (drift
  since this plan was written) — especially the exact shape of the
  `.catch` handler's fallback object, since the fix depends on it being
  exactly `{status: 'done', message}` today.
- `assessment`'s `tone` field turns out not to accept `'critical'` for
  some reason (e.g. a narrower local type than `InboxItem['tone']`) —
  report the actual type rather than working around it.
- `handleAssess`'s existing same-tick race-guard tests (referenced in the
  surrounding doc comments) fail after this change — that would mean the
  new field somehow interacts with the in-flight-ref guarding logic, which
  it shouldn't; report rather than modifying the guard logic to make tests
  pass.

## Maintenance notes

- If `assess.unavailable`'s own message (a specific sub-case of assess
  failure, for a document type this feature genuinely can't assess) should
  render with a *different* tone than a generic `assess.error` (e.g.
  `caution` instead of `critical`, since "not applicable here" reads
  differently than "the network call failed") — that's a legitimate
  follow-up refinement not attempted in this plan; both currently get the
  same `tone: 'critical'` for simplicity. A reviewer can decide if that
  distinction is worth making.
- A reviewer should visually confirm in a live Studio that triggering an
  assess/fix failure (e.g. by temporarily breaking the Agent Actions
  client, or reviewing existing test coverage if a live check isn't
  practical) now shows a colored card, not plain text.
