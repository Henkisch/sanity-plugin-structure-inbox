# Plan 092: Make `documentValidation` cheap enough not to freeze the Studio

## Status

- **Priority**: P2
- **Effort**: M
- **Category**: performance
- **Depends on**: none
- **State**: TODO. Found 2026-09-23 while testing PR #10 on a real Studio.

## The finding

On a real Studio (a `pageBuilder` site with async `isUnique` slug rules), enabling
`documentValidation()` froze the browser tab for 45 s or more after a cold load. The
DevTools protocol couldn't even evaluate a script.

This is **the same on 2.4.0**, so it is not a regression. It is also why findings
used to go missing: each draft's 10 s timeout expired while the main thread was busy
validating the other drafts, and the draft was then dropped silently. PR #10 added
retries with longer timeouts, so the findings now arrive, but slowly (under a minute
on that Studio), and the freeze is still there.

## Steps

1. **Measure first.** Time `validateDocument` per draft and in total on a heavy
   Studio. Separate CPU time (schema walk, rule evaluation) from waiting on the
   network (reference checks, `isUnique` queries). Don't pick a fix before the numbers
   say which cost dominates.
2. **Candidate fixes**, cheapest first:
   - **Validate only what changed.** Cache results by `_id` + `_rev`. A reload still
     pays once; every refetch after that is free. Today, any new `drafts` array
     identity re-runs every draft.
   - **Yield between documents.** Concurrency 1–2 plus a `scheduler.yield()` /
     `setTimeout(0)` between drafts keeps the UI responsive at the same total cost.
   - **Defer.** Start validation after the Studio has settled
     (`requestIdleCallback`), not during its own startup.
   - **Off the main thread.** A worker would need the schema and the rules there. That
     is probably not possible with user-defined rules that close over Studio context,
     so treat it as a last resort.
3. **Keep the guarantee:** a draft that couldn't be evaluated must never read as
   "fine". Keep the `warnOnce`, and consider a visible "N drafts couldn't be checked"
   note.

## Verification

- A cold load of a heavy Studio with `documentValidation()` never leaves the tab
  unresponsive.
- Findings still appear, and appear sooner than today.
