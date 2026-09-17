# Plan 051: Fix four small, real wording inconsistencies in the pane's user-facing copy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/i18n/locales/en-US.ts`
> If this file changed since this plan was written, re-run the `grep`
> commands in each step before proceeding — the line numbers below will
> have shifted; use the grep results, not the line numbers, as ground
> truth.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs (UI/wording consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

`src/i18n/locales/en-US.ts` is the single source of truth for nearly every
user-facing string in this plugin (~157 keys), and this plugin's own
`README.md` documents that integrators can override individual keys via
`defineLocaleResourceBundle` (see README.md, `## Localization` section).
That means **changing an existing key's English string value is safe and
non-breaking** — an integrator's override binds to the key id, not the
value — but **renaming or removing a key would be a breaking change**.
Every fix in this plan changes only string *values* on existing keys; no
key is renamed, added, or removed.

Four small, independently-verified wording inconsistencies survive a close
read of this file (out of ~157 keys, the overwhelming majority are
already consistent — sentence case throughout, "AI" correctly kept as an
acronym, all six `'Could not reach AI.'` error strings identical, all
loading-state ellipses consistent). Fixing these four is cheap and safe;
each is its own step so a reviewer can accept or skip any one
independently.

## Current state

All four current values, confirmed by direct read of
`src/i18n/locales/en-US.ts`:

- **Line 39-41** — the three per-tab empty-state strings, which all render
  in the identical UI slot (see `src/inbox/InboxSection.tsx` and
  `src/inbox/MergedList.tsx`, both switching on `view` with:
  `view === 'cleared' ? t('source.noneCleared') : view === 'snoozed' ?
  t('source.noneSnoozed') : t('source.empty')`):
  ```ts
  'source.empty': 'All clear.',
  'source.noneCleared': 'Nothing cleared yet.',
  'source.noneSnoozed': 'Nothing snoozed.',
  ```
  Two of three follow a "Nothing {state} yet." shape; `source.empty`
  breaks it with an idiom.

- **Lines 109 and 120** — two suggestion-chip labels that are the *same*
  UI shape (a resolved suggestion whose click immediately performs the
  action, not a re-ask — see `src/inbox/SelectionActions.tsx:317`
  `onClick={() => onSnoozeUntil(snoozeSuggestion.until)}` and `:369`
  `onClick={() => onAssign(suggestedUser.id)}`):
  ```ts
  'action.snooze.suggested': 'Until {{date}}',
  'action.assign.suggested': 'Suggest {{name}}',
  ```
  The snooze chip states the resolved value plainly; the assign chip
  keeps a verb that reads as tentative even though the click commits
  immediately.

- **Line 46**, compared with lines 42, 143, 150 — the same referent (the
  logged-in editor) capitalized two different ways depending on context:
  ```ts
  'assignee.you': '{{name}} (You)',      // renders inline next to real names, e.g. "Bob (You)"
  'audience.mine': 'Assigned to you',    // sentence form
  'inbox.section.private': 'Only you',   // sentence form
  'cleared.manual': 'Cleared by you',    // sentence form
  ```

- **Line 174**, compared with its siblings at lines 165, 183, and the six
  identical `'Could not reach AI.'` strings at lines 164, 175, 188, 205,
  229, 248:
  ```ts
  'ask.unparseable': 'AI answered, but not in a way I could use.',
  'assess.unavailable': 'AI could not read this one.',
  'fix.none': "AI couldn't find a good match.",
  ```
  Every other AI-outcome string names "AI" as the subject or stays fully
  impersonal; `ask.unparseable` alone slips into an unattributed
  first-person "I".

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run`      | all pass             |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope**:
- `src/i18n/locales/en-US.ts` — string-value changes on the 4 existing
  keys named above. Do not touch any other key.

**Out of scope**:
- Do NOT rename, remove, or add any i18n key.
- Do NOT touch `assign` vs `transfer` ("Hand off to…") wording, or
  `openTasks`'s "Task" vs `todos`'s "Todo" wording — both are deliberate,
  documented distinctions (see README.md), not inconsistencies.
- Do NOT touch any of the six identical `'Could not reach AI.'` strings —
  they are already fully consistent.
- Do NOT touch any test file. Confirm first (Step 0) that no test asserts
  the literal English string values being changed (tests in this repo
  reference i18n keys directly, e.g. `screen.getByText('source.noneSnoozed')`
  — the key id, not the rendered English string — so changing a value
  should not break any test, but verify this assumption before proceeding).

## Git workflow

- Branch: `advisor/051-wording-inconsistencies`
- One commit per fix, or one combined commit — either is fine for a
  change this size. Message if combined:
  `docs: fix four small wording inconsistencies in user-facing copy`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Confirm no test asserts the literal English values being changed

Run:
```
grep -rn "All clear\.\|Suggest {{name}}\|(You)\|I could use" src/**/*.test.tsx src/**/*.test.ts 2>/dev/null
```
Expected: no matches (this repo's tests assert on i18n *keys*, e.g.
`t('source.empty')` or `'source.empty'` as the literal string passed to
`getByText`, not on the rendered English value). If this grep finds a
match, STOP and report it — do not proceed with the corresponding change
until you've confirmed whether that test needs updating too.

### Step 1: Fix the empty-state copy (`source.empty`)

Change line 39 from `'source.empty': 'All clear.'` to `'source.empty':
'Nothing open.'` — matching the "Nothing {state}." shape its two siblings
(`source.noneCleared`, `source.noneSnoozed`) already use.

**Verify**: `grep -n "'source.empty':" src/i18n/locales/en-US.ts` → shows
the new value.

### Step 2: Fix the assign-suggestion chip label (`action.assign.suggested`)

Change line 120 from `'action.assign.suggested': 'Suggest {{name}}'` to
`'action.assign.suggested': '{{name}}'` — matching
`action.snooze.suggested`'s value-only shape (`'Until {{date}}'` keeps the
preposition because it's grammatically required to read as a date; a bare
name needs no leading verb to read the same way).

**Verify**: `grep -n "'action.assign.suggested':" src/i18n/locales/en-US.ts`
→ shows the new value.

### Step 3: Fix the "(You)" capitalization (`assignee.you`)

Change line 46 from `'assignee.you': '{{name}} (You)'` to `'assignee.you':
'{{name}} (you)'` — lowercase, matching every other sentence-form
reference to the viewer elsewhere in this file (`audience.mine`,
`inbox.section.private`, `cleared.manual`).

**Verify**: `grep -n "'assignee.you':" src/i18n/locales/en-US.ts` → shows
the new value.

### Step 4: Fix the first-person slip (`ask.unparseable`)

Change line 174 from `'ask.unparseable': 'AI answered, but not in a way I
could use.'` to `'ask.unparseable': "AI answered, but not in a way this
pane could use."` — staying third-person/impersonal like every sibling
AI-outcome string.

**Verify**: `grep -n "'ask.unparseable':" src/i18n/locales/en-US.ts` →
shows the new value, and confirm it contains no unattributed "I".

## Test plan

- No new tests are needed for this plan — it changes only string values
  on existing i18n keys, and this repo's tests assert on key ids, not
  rendered English values (confirmed in Step 0).
- Verification: `npx vitest run` (full suite) → all pass, same pass count
  as before this change (no new failures, no new tests expected).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0, same pass count as before this plan (no
      regressions, since only English string values changed)
- [ ] `npm run build` exits 0
- [ ] All four `grep` checks in Steps 1–4 show the new values
- [ ] `git status` shows only `src/i18n/locales/en-US.ts` changed
- [ ] `plans/README.md` status row for plan 051 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 0's grep finds a test asserting one of the literal English values
  being changed — figure out which test and whether it needs a
  corresponding update before proceeding with that specific fix (the other
  three, if unaffected, can still proceed).
- Any of the four cited keys' current values don't match what's in this
  plan (drift since it was written) — re-derive the correct line via grep
  rather than trusting the line numbers above.

## Maintenance notes

- These are cosmetic, low-risk copy fixes. A reviewer mainly needs to
  confirm the four new strings read naturally in context (ideally by
  looking at each in a live Studio: the Open-tab empty state, the assign-
  suggestion chip, an assignee avatar labeled "(you)", and Ask's
  unparseable-response message).
- If a non-English locale bundle is ever added to this plugin (none exists
  today — `en-US.ts` is the only locale file), these four keys are exactly
  the ones a translator should double-check for tone, since this plan is
  explicitly about voice/register consistency.
