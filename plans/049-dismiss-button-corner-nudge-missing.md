# Plan 049: Result-card "Dismiss" button loses its corner-flush nudge in 4 of 9 identical slots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1ef4078..HEAD -- src/inbox/Inbox.tsx`
> If `src/inbox/Inbox.tsx` changed since this plan was written, re-run the
> `grep` commands in Step 1 before proceeding — the line numbers below will
> have shifted; use the grep results, not the line numbers, as ground truth.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI consistency)
- **Planned at**: commit `1ef4078`, 2026-09-17

## Why this matters

`src/inbox/Inbox.tsx` renders 9 structurally identical "Dismiss" buttons —
one in the top-right corner of every AI/action result card (Ask, Summarize,
Suggest todos ×3 states, Find content gaps ×3 states, and one source-action
result card). 5 of these 9 carry `style={{marginRight: -8, marginTop: -6}}`
so the button sits flush with the card's own rounded corner instead of
sitting a visible few pixels inside it. The other 4 — Suggest todos' own
"error" and "no suggestions" states, and Find content gaps' matching
"error" and "no results" states — use the exact same `Button` in the exact
same position, but with no `style` override at all. Suggest todos and Find
content gaps both toggle between these very states on repeated use (a
re-run can go from "no suggestions" to "3 suggestions" to "error" and
back), so an editor watching the same card re-render across those
transitions sees its own Dismiss button visibly hop a few pixels — reading
as a layout glitch, not as one of this file's many deliberate, documented
micro-adjustments.

## Current state

Confirmed via `grep -n "marginRight: -8" src/inbox/Inbox.tsx` — exactly 5
matches today, at (approximately) lines 1350, 1386, 1469, 1581, 1661. One
example, the Ask result's own Dismiss button (has the nudge):
```tsx
<Button
  fontSize={1}
  mode="bleed"
  onClick={() => setAskResult({status: 'idle'})}
  padding={2}
  style={{marginRight: -8, marginTop: -6}}
  text={t('ask.dismiss')}
/>
```

The 4 missing sites, confirmed by direct read — Suggest todos' error state
(current code, no `style`):
```tsx
<Flex align="flex-start" gap={3} justify="space-between">
  <Text size={1}>{t('todoSuggest.error')}</Text>
  <Button
    fontSize={1}
    mode="bleed"
    onClick={() => setSuggestions({status: 'idle'})}
    padding={2}
    text={t('todoSuggest.dismiss')}
  />
</Flex>
```
Suggest todos' "none found" state (same shape, `t('todoSuggest.none')`
above it, `text={t('todoSuggest.dismiss')}`). Find content gaps' error
state (current code, no `style`):
```tsx
<Flex align="flex-start" gap={3} justify="space-between">
  <Text size={1}>{t('contentGaps.error')}</Text>
  <Button
    fontSize={1}
    mode="bleed"
    onClick={() => setContentGapsResult({status: 'idle'})}
    padding={2}
    text={t('contentGaps.dismiss')}
  />
</Flex>
```
Find content gaps' "none found" state (same shape, `t('contentGaps.none')`
above it).

All 4 missing sites are inside the same kind of card (`Card ... radius={2}
tone={status === 'error' ? 'critical' : 'primary'}`) as the 5 that already
have the nudge — same card shape, same button shape, same corner position.
The only difference is the missing `style` prop.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Lint      | `npm run lint`        | exit 0               |
| Tests     | `npx vitest run src/inbox/Inbox.test.tsx` | all pass |
| Full test | `npx vitest run`      | all pass             |
| Build     | `npm run build`       | exit 0               |

Do **not** run `npm run format` (repo-wide `oxfmt`) — it has been observed
to reformat far more of the tree than intended on this repo. Match
surrounding style by hand.

## Scope

**In scope**:
- `src/inbox/Inbox.tsx` only — add `style={{marginRight: -8, marginTop:
  -6}}` to exactly the 4 Dismiss buttons identified above (Suggest todos'
  error + none states, Find content gaps' error + none states).

**Out of scope**:
- Do NOT touch the 5 buttons that already have the nudge.
- Do NOT touch any other Dismiss/close button elsewhere in the codebase
  (e.g. per-row dismiss controls in `InboxRow.tsx`) — this plan is scoped
  to these 9 specific pane-level result-card buttons only.
- Do NOT refactor the 9 call sites into one shared component in this plan,
  even though the duplication itself is a real, separate finding (noted in
  Maintenance notes below) — that is a larger structural change out of
  scope here.

## Git workflow

- Branch: `advisor/049-dismiss-button-corner-nudge`
- One commit: `fix: give the 4 remaining Dismiss buttons the same corner-flush nudge their siblings already have`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Locate the 4 exact call sites

Run:
```
grep -n "todoSuggest.dismiss\|contentGaps.dismiss" src/inbox/Inbox.tsx
```
This returns the `text={t(...)}` line for all 4 relevant Dismiss buttons
(2 for `todoSuggest`, 2 for `contentGaps` — the ones NOT already carrying
`style={{marginRight: -8, marginTop: -6}}`). Cross-reference against
`grep -n "marginRight: -8" src/inbox/Inbox.tsx` to confirm which of the
`todoSuggest.dismiss`/`contentGaps.dismiss` buttons are missing it (there
should be exactly 2 `todoSuggest.dismiss` and 2 `contentGaps.dismiss`
buttons with no nearby `marginRight: -8` line — these 4 are your targets).

**Verify**: the grep output identifies exactly 4 target buttons, matching
the excerpts in "Current state" above.

### Step 2: Add the missing `style` prop to each of the 4 buttons

For each of the 4 target `<Button>` elements, add
`style={{marginRight: -8, marginTop: -6}}` as a prop, in the same
alphabetical position the other 5 already use it (between `padding` and
`text`, matching the example in "Current state" exactly).

**Verify**: `grep -c "marginRight: -8" src/inbox/Inbox.tsx` → now returns
`9` (was `5`).

## Test plan

This is a pure inline-style addition with no new branch logic — the most
useful verification is confirming the count and re-running the existing
suite, since a snapshot/DOM test asserting an inline `style` value would
be brittle for something this cosmetic and this codebase doesn't appear to
test inline styles directly (confirm this by checking
`src/inbox/Inbox.test.tsx` for any existing `style`-asserting test before
deciding whether to add one).

- If `Inbox.test.tsx` already has a pattern for asserting a specific
  button's inline style (search for `marginRight` or `style=` in that
  file), add one test per newly-nudged button following that exact
  pattern. If no such pattern exists anywhere in this test file, do not
  invent one — the 9-way `grep -c` count check in Step 2 plus a full test
  suite pass is sufficient verification for a cosmetic style-only change.
- Verification: `npx vitest run` → all pass (no new failures; this change
  should not affect any existing test's assertions since none of them are
  expected to check this specific inline style).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0, no new failures
- [ ] `npm run build` exits 0
- [ ] `grep -c "marginRight: -8" src/inbox/Inbox.tsx` returns `9`
- [ ] `git status` shows only `src/inbox/Inbox.tsx` changed (plus a test
      file only if Step's optional test-plan branch applied)
- [ ] `plans/README.md` status row for plan 049 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The grep in Step 1 returns a different count than expected (e.g. more or
  fewer than 4 missing sites, or more/fewer than 9 total
  `todoSuggest.dismiss`/`contentGaps.dismiss`/other Dismiss buttons) — the
  file has drifted since this plan was written; re-derive the correct
  target list from the live grep output rather than blindly trusting the
  line numbers above.
- Any of the 4 target buttons' surrounding `Flex`/`Card` structure looks
  meaningfully different from the "Current state" excerpts (e.g. a
  different `justify`/`align` value) — report this rather than force-
  fitting the same style value, since the nudge's correctness depends on
  the surrounding layout matching the other 5 sites.

## Maintenance notes

- The real underlying issue — the same "title/message + corner Dismiss"
  row is hand-duplicated 9 times in this one file — is itself worth a
  follow-up: factoring it into one small shared component (e.g.
  `ResultCardDismissRow`) would make this exact class of drift impossible
  going forward. That is a larger, separate refactor and is deliberately
  not part of this plan's scope; flag it to the maintainer as a follow-up
  candidate if this pattern needs touching again.
- A reviewer should visually confirm in a live Studio that toggling
  Suggest todos / Find content gaps between their "none"/"error"/"done"
  states no longer produces a visible jump in the Dismiss button's
  position.
