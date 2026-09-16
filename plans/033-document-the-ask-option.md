# Plan 033: Document the `ask` config option

> **Executor instructions**: Follow this plan step by step. When done,
> update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e33fb29..HEAD -- README.md src/types.ts`
> If either changed since this plan was written, re-read both before
> proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `e33fb29`, 2026-09-16

## Why this matters

`ask` (`StructureInboxConfig.ask`, `src/types.ts`) is a real, fully
implemented, shipped feature — an editor can select rows by typing a
plain-language question instead of reading and ticking each one. It has no
row in the README's own "## Options" table, and no dedicated explainer
section the way its sibling opt-in AI features do (`contentGaps` gets a
full "Optional: finding content gaps" section; `ask` gets a single
comma-separated mention in prose and nothing else). For a package whose
only public documentation is this README, an integrator scanning for
available features has no real way to discover this one, what it costs, or
how to turn it on.

## Current state

- `src/types.ts` — `ask`'s own doc comment (the exact copy to draw the new
  section's explanation from):
  ```ts
  /**
   * Lets an editor select rows by asking a plain-language question ("things
   * about the spring campaign") instead of reading and ticking each one —
   * shown as a single-line input in the Open view's own header.
   *
   * The AI's only output is a selection: it never resolves, dismisses, or
   * snoozes anything itself, and only rows already on screen (after any
   * active filter) are candidates. Off by default: it spends an Agent
   * Actions request per question, and needs Agent Actions available in the
   * Studio (silently does nothing useful without it — the input still
   * renders, since knowing that in advance would need its own request).
   *
   * @defaultValue false
   */
  ask?: boolean
  ```
- `README.md:714-723` — the entire current "## Options" table (five rows:
  `sources`, `title`, `toolName`, `showInList`, `redirectOnLanding`) — no
  `ask` row.
- `README.md:828-864` — "## Optional: finding content gaps", the section
  to model the new one after (quoted in full — see this plan's own recon,
  or read it directly): a config snippet, one paragraph on what appears
  and what it does, a paragraph on `context` mattering here, a paragraph on
  its one real caveat (a judgment call, not a fact — `ask`'s equivalent
  caveat is different: it's a *selection* tool, not an *insight*, so don't
  copy that specific caveat, write `ask`'s own).
- `README.md:756` — the one existing prose mention of `ask` (comma-listed
  alongside other AI features) — leave this line as-is; it's accurate,
  just not sufficient on its own.
- `src/inbox/AskInbox.tsx` — the actual implementation, if you want to
  confirm any behavioral detail beyond what the doc comment already states
  (e.g. that it renders as a single-line input in the Open view's header,
  already stated in the doc comment above).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| None — docs-only change | — | — |

Manually cross-check the new section's every claim against
`src/types.ts`'s own doc comment and `src/inbox/AskInbox.tsx`'s actual
behavior.

## Scope

**In scope**:
- `README.md` (the Options table, and a new section)

**Out of scope**:
- `src/types.ts` — the doc comment there is already accurate; this plan
  only surfaces it in the README, doesn't change it.
- Any other README section.

## Git workflow

- Commits land directly on `main`. Message style: `docs: document the ask
  config option`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add a row to the Options table

In `README.md`'s "## Options" table, add:

```md
| `ask`               | `boolean`       | `false`           | Lets an editor select rows by asking a plain-language question. See "Asking about all your items" below. |
```

(Match the table's own existing column alignment style — read the table's
current formatting first, since markdown tables in this file appear
hand-aligned with padding spaces, not just single spaces.)

**Verify**: `grep -n "| \`ask\`" README.md` → one match, inside the Options
table.

### Step 2: Add a dedicated section

Add a new section, placed near "## Optional: finding content gaps" (either
just before or just after it — both are opt-in pane-wide AI reads, grouping
them together reads best, but exact placement is your judgment call).
Model the structure after that section (config snippet, what appears,
what it costs/needs, its own real caveat) but write `ask`'s own content,
not a copy — draw directly from `src/types.ts`'s doc comment quoted above.
Suggested shape:

```md
## Optional: asking about all your items

\`\`\`ts
structureInbox({
  ask: true,
  sources: [
    /* ... */
  ],
})
\`\`\`

With `ask` on, a single-line "Ask about these items…" input appears in the
Open view's own header. Type a plain-language question ("things about the
spring campaign") and the AI selects which on-screen rows match — only
rows already visible after any active filter are candidates. Its only
effect is selection: it never resolves, dismisses, or snoozes anything on
your behalf.

Off by default: it spends an Agent Actions request per question. It also
needs Agent Actions available in the Studio — without it, the input still
renders but does nothing useful, since checking that in advance would
itself cost a request.
```

Adjust wording as needed so it reads naturally next to the surrounding
sections' own voice — this is a suggested shape, not a literal
copy-paste requirement.

**Verify**: manually re-read the new section against `src/types.ts`'s doc
comment — every factual claim (off by default, per-question cost, only
selects visible rows, needs Agent Actions) must trace back to that comment
or to `AskInbox.tsx`'s actual code, not be invented.

## Test plan

No automated tests apply to a documentation addition.

## Done criteria

- [ ] `grep -n "| \`ask\`" README.md` finds the new Options-table row
- [ ] A new section documenting `ask` exists, distinct from the existing
      one-line mention at (originally) line 756
- [ ] No files outside `README.md` are modified (`git status`)
- [ ] `plans/README.md` status row for 033 updated

## STOP conditions

- `src/types.ts`'s `ask` doc comment has changed in a way that contradicts
  this plan's quoted excerpt (re-read it and write the section to match
  the current, real behavior rather than this plan's possibly-stale copy).

## Maintenance notes

Any future opt-in, pane-wide AI feature should get both an Options-table
row and its own section from the start — this plan exists specifically
because `ask` didn't, and shouldn't need repeating for the next one.
