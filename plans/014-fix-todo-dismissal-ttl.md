# Plan 014: Stop a finished todo from silently reappearing after 90 days

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 32e028c..HEAD -- src/store/dismissals.ts src/store/useDismissals.ts src/inbox/types.ts src/inbox/sources/todos.ts src/inbox/Inbox.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (additive, opt-in field; default behavior for every existing
  source is unchanged)
- **Depends on**: none
- **Category**: correctness (found during a lifecycle-focused `/improve` pass,
  2026-09-13)
- **Planned at**: commit `32e028c`, 2026-09-13

## Why this matters

Dismissals age out after 90 days (`DISMISSAL_TTL_DAYS`,
`src/store/dismissals.ts:25`) — by design, and correctly so for most sources:
an unpublished draft dismissed months ago and *still* not published is
exactly the case the TTL exists to resurface (`dismissals.ts:19-23`'s own
comment: "an item still present after this long is one the editor has
evidently chosen to live with" — a nudge, not a bug).

`todos` is the one built-in source where this same mechanism is actively
wrong. A todo has no `resolve` (`src/inbox/sources/todos.ts` — nothing else
completes it), so marking one "done" *only* ever calls `dismissals.dismiss()`
— confirmed by reading the actual confirm flow, which never calls `remove`
when a source has no `resolve`:

```tsx
// src/inbox/InboxSection.tsx:170-177
setBusy(true)
try {
  // `allSettled` rather than `all`: one item failing should not strand the
  // others, and each is marked done only once its own resolve succeeded
  // (or, with no `resolve` at all, unconditionally).
  const results = await Promise.allSettled(
    targets.map((item) => (resolve ? resolve(item) : Promise.resolve())),
  )
```

`src/store/todos.ts` already names this exact tension in its own doc comment,
unresolved until now:

```ts
// src/store/todos.ts:110-117
/**
 * Removes a todo for good — not a dismissal, which only hides it while
 * leaving it in this list forever. Marking one done still goes through the
 * shared dismissal record like any other source; this is for clearing out
 * ones already finished, so the list doesn't just grow, and so a todo's
 * "done" state doesn't depend solely on a dismissal that eventually ages out
 * (see the 90-day TTL in `dismissals.ts`).
 */
export function withoutTodo(state: TodosState, id: string): TodosState {
```

So today: an editor finishes a todo, marks it done (dismisses it), never
separately hits "Delete" (there is no batch delete for todos either — the
per-row delete button only ever shows for a single selected row, per
`InboxRow.tsx`'s "only for a lone selected row" comment). 91+ days later, the
dismissal ages out and the todo — a task the editor genuinely finished months
ago — silently reappears in Open. This reads as data loss/a ghost task, not
a nudge, because a todo (unlike a draft) has no notion of "still needs
finishing" that the passage of time could make newly true again.

## Current state

**`src/store/dismissals.ts`** (whole file already read in full during recon;
relevant part):

```ts
// src/store/dismissals.ts:16-25
/**
 * How long a dismissal is remembered.
 *
 * Dismissals are the only thing here that grows without bound: an item can
 * vanish from its source at any time, and nothing tells us it is gone, so
 * entries can never be pruned by checking against live items. Ageing them out
 * keeps the stored value small, and an item still present after this long is
 * one the editor has evidently chosen to live with.
 */
export const DISMISSAL_TTL_DAYS = 90
```

```ts
// src/store/dismissals.ts:50-65
/** Drops entries older than {@link DISMISSAL_TTL_DAYS}. */
export function pruneDismissals(state: DismissalState, now = Date.now()): DismissalState {
  const cutoff = now - DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  const dismissed: DismissalState['dismissed'] = {}

  for (const [source, items] of Object.entries(state.dismissed)) {
    const kept = Object.entries(items).filter(([, at]) => {
      const time = Date.parse(at)
      // An unparseable timestamp is one we did not write; drop it.
      return Number.isFinite(time) && time >= cutoff
    })
    if (kept.length > 0) dismissed[source] = Object.fromEntries(kept)
  }

  return {version: DISMISSAL_VERSION, dismissed}
}
```

**`src/store/useDismissals.ts`** — the only caller of `pruneDismissals`, and
the hook's current signature (whole relevant slice):

```ts
// src/store/useDismissals.ts:62
export function useDismissals(): Dismissals {
```

```ts
// src/store/useDismissals.ts:162-169
const update = useCallback((next: (current: DismissalState) => DismissalState) => {
  // Pruned on write rather than on read: reads happen on every render, and
  // an editor who never dismisses anything should not pay for maintenance
  // of a value they are not growing.
  dirtyRef.current = true
  hasLocalEditRef.current = true
  setState((current) => pruneDismissals(next(current)))
}, [])
```

**`src/inbox/types.ts:179-221`** — the whole `InboxSource` interface, the
static per-source declaration a new opt-out flag joins (right after
`audience`, following the same pattern — a plain, documented, optional,
`@defaultValue`-annotated field):

```ts
export interface InboxSource {
  /** Stable identifier. Namespaces this source's dismissals. */
  name: string
  /** Group heading in the inbox. */
  title: string
  icon?: ComponentType

  /**
   * Which column this source belongs in.
   * ...
   * @defaultValue 'main'
   */
  placement?: 'main' | 'aside'

  /**
   * Who this source's items belong to.
   * ...
   * @defaultValue 'everyone'
   */
  audience?: 'mine' | 'everyone'

  /**
   * Returns this source's items.
   * ...
   */
  useItems: () => InboxSourceResult
}
```

**`src/inbox/sources/todos.ts`** — the source object this plan's new field
gets set on (already read in full during recon; the relevant slice):

```ts
// src/inbox/sources/todos.ts:44-53
export function todos(options: TodosOptions = {}): InboxSource {
  const {title = 'Todo', placement = 'main'} = options

  return {
    name: 'todos',
    title,
    icon: CheckmarkCircleIcon,
    placement,
    audience: 'mine',
    // (useItems below)
```

**`src/inbox/Inbox.tsx:151-154`** — where `useDismissals()` is called, with
`sources` already in scope as a plain `InboxSource[]`:

```tsx
export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const dismissals = useDismissals()
  const snoozes = useSnoozes()
```

**Repo conventions to match**:

- Public-facing opt-out/opt-in fields on `InboxSource` are plain optional
  booleans or string unions, documented with a `@defaultValue` tag and a
  paragraph explaining *why* a Studio might turn it on — see `audience`
  above for the house style.
- Pure store functions (`dismissals.ts`, `snoozes.ts`, `todos.ts`) take no
  React/Studio dependencies and are covered by colocated `*.test.ts` files
  with plain object-literal fixtures — see `src/store/dismissals.test.ts`.
- New optional parameters default to preserving existing behavior exactly —
  see how `now = Date.now()` on `pruneDismissals` and `at =
  new Date().toISOString()` on `withDismissal` are both optional with a
  sensible default, never a required new argument that breaks existing
  callers.

## Scope

**In scope**:
- `src/store/dismissals.ts` — `pruneDismissals` gains a new optional third
  parameter for source names to exempt from the TTL.
- `src/store/useDismissals.ts` — `useDismissals` gains a new optional
  parameter, threaded straight through to `pruneDismissals`.
- `src/inbox/types.ts` — `InboxSource` gains one new optional field.
- `src/inbox/sources/todos.ts` — sets that new field.
- `src/inbox/Inbox.tsx` — computes the exempt-source-name list from
  `sources` and passes it to `useDismissals`.
- `src/store/dismissals.test.ts` — new test cases for the pruning exemption.
- `README.md` — one clarifying sentence in the existing "Where 'done' is
  stored" section (`README.md:301-323`).

**Out of scope**:
- `src/inbox/InboxSection.tsx`, `src/inbox/MergedList.tsx` — the confirm/mark
  done flow itself is not changing; a todo still gets dismissed the same way
  every other item does. This plan only changes whether that dismissal can
  expire, not what marking done does.
- `src/store/snoozes.ts` — snoozes already self-prune correctly (a snooze
  has no reason to persist once its own wake time passes); this plan does
  not touch snooze behavior at all.
- Adding a batch "Delete" action for todos, or auto-deleting a todo when it's
  marked done instead of dismissing it — a real alternative fix, but a
  materially different UX decision (todos would stop appearing in the Done
  tab at all, immediately, instead of lingering there like every other
  source's done items). Out of scope; if a future maintainer prefers that
  design, it is a separate plan, not a revision of this one.
- Any other built-in source (`unpublishedDrafts`, `openTasks`,
  `upcomingReleases`) — none of them should get this new field. See "Why
  this matters" for why `unpublishedDrafts`/`upcomingReleases`, despite also
  having no `resolve`, are *not* in scope: their TTL-driven resurfacing is
  correct, intentional behavior, not a bug.

## Git workflow

- Branch: `advisor/014-fix-todo-dismissal-ttl`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, no period: e.g. `fix: exempt todos from the dismissal TTL`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|-----------------------|----------------------|
| Install   | `npm install`         | exit 0               |
| Typecheck | `npm run typecheck`   | exit 0, no errors    |
| Tests     | `npm test`             | all pass             |
| Lint      | `npm run lint`         | exit 0               |
| Build     | `npm run build`        | exit 0               |

## Steps

### Step 1: Add the exemption parameter to `pruneDismissals`

In `src/store/dismissals.ts`, change the signature and skip pruning for any
source name in the new set:

```ts
/**
 * Drops entries older than {@link DISMISSAL_TTL_DAYS} — except for a source
 * named in `neverExpireSources`, whose entries are kept regardless of age.
 *
 * Most sources want the TTL: an item still dismissed after this long is one
 * the editor has evidently chosen to live with (see the doc comment above),
 * and letting it resurface is a deliberate nudge. A source with no other way
 * to mark something truly finished — `todos` is the only built-in example —
 * has no such nudge to give: there is nothing else that could make a
 * genuinely-finished todo "not done" again, so ageing its dismissal out only
 * looks like data loss.
 */
export function pruneDismissals(
  state: DismissalState,
  now = Date.now(),
  neverExpireSources: readonly string[] = [],
): DismissalState {
  const exempt = new Set(neverExpireSources)
  const cutoff = now - DISMISSAL_TTL_DAYS * 24 * 60 * 60 * 1000
  const dismissed: DismissalState['dismissed'] = {}

  for (const [source, items] of Object.entries(state.dismissed)) {
    if (exempt.has(source)) {
      dismissed[source] = items
      continue
    }

    const kept = Object.entries(items).filter(([, at]) => {
      const time = Date.parse(at)
      return Number.isFinite(time) && time >= cutoff
    })
    if (kept.length > 0) dismissed[source] = Object.fromEntries(kept)
  }

  return {version: DISMISSAL_VERSION, dismissed}
}
```

Note: an exempt source's entries are kept **as-is**, including any with an
unparseable timestamp — those are exceedingly rare (only ever written by a
future/foreign version of this plugin) and pruning them is a minor hygiene
detail, not the point of this change. Do not special-case that inside the
`exempt` branch; keeping the branch simple is deliberate.

**Verify**: `npm run typecheck` → exit 0, no errors.

### Step 2: Thread it through `useDismissals`

In `src/store/useDismissals.ts`, add an optional parameter and pass it to
`pruneDismissals`:

```ts
export function useDismissals(neverExpireSources: readonly string[] = []): Dismissals {
```

```ts
const update = useCallback(
  (next: (current: DismissalState) => DismissalState) => {
    dirtyRef.current = true
    hasLocalEditRef.current = true
    setState((current) => pruneDismissals(next(current), Date.now(), neverExpireSources))
  },
  [neverExpireSources],
)
```

(Adding `neverExpireSources` to `update`'s dependency array is required
because it's now referenced inside the callback — `useCallback`'s exhaustive
rule the rest of this file already follows.)

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Add the field to `InboxSource` and set it on `todos`

In `src/inbox/types.ts`, add directly after the `audience` field
(`types.ts:209`):

```ts
/**
 * Exempts this source's dismissals from the 90-day TTL that ages out every
 * other source's (see `DISMISSAL_TTL_DAYS` in `src/store/dismissals.ts`).
 *
 * Most sources want the TTL — a still-dismissed item resurfacing after this
 * long is a deliberate "you evidently haven't finished this" nudge. Turn
 * this on only for a source with no other way to mark something truly
 * finished (no `resolve`, and nothing external that could make a dismissed
 * item newly relevant again) — `todos` is the only built-in example, since
 * dismissing one is the only "done" a todo has.
 *
 * @defaultValue false
 */
neverExpireDismissals?: boolean
```

In `src/inbox/sources/todos.ts`, set it on the returned source object,
alongside `audience`:

```ts
return {
  name: 'todos',
  title,
  icon: CheckmarkCircleIcon,
  placement,
  audience: 'mine',
  neverExpireDismissals: true,
  // ...
```

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Wire it in `Inbox.tsx`

In `src/inbox/Inbox.tsx`, compute the exempt source names from `sources` and
pass them to `useDismissals`:

```tsx
export function Inbox({sources}: InboxProps) {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const neverExpireDismissalSources = useMemo(
    () => sources.filter((source) => source.neverExpireDismissals).map((source) => source.name),
    [sources],
  )
  const dismissals = useDismissals(neverExpireDismissalSources)
  const snoozes = useSnoozes()
```

Check whether `useMemo` is already imported in this file (it almost
certainly is, given the rest of the component) — add it to the existing
import from `'react'` if not.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Tests

In `src/store/dismissals.test.ts`, add to the existing `describe('pruneDismissals', ...)` block (read it first — it already defines `now`/`iso` helpers at the top of that block; reuse them):

1. **Keeps an exempt source's entries past the TTL** — a `todos` entry older
   than `DISMISSAL_TTL_DAYS`, pruned with `['todos']` as the third argument,
   survives unchanged.
2. **A non-exempt source in the same state still gets pruned normally** —
   same call, a `drafts` entry of the same age is dropped — proves the
   exemption is per-source, not global.
3. **Omitting the third argument preserves today's behavior exactly** — call
   `pruneDismissals(state, now)` with no third argument on a state containing
   an old `todos` entry; it is still dropped, exactly like before this plan
   — the default empty exemption list must not change any existing call
   site's behavior.

**Verify**: `npm test -- dismissals` → all pass, including the 3 new cases.

### Step 6: README

In `README.md`'s "Where 'done' is stored" section (`README.md:320-323`),
extend the existing todos sentence to mention the exemption:

```
Snoozes and todos each live in a sibling document of their own — same
per-editor, unregistered-type approach, kept apart because neither shares a
lifecycle with a dismissal: a snooze expires on its own, and a todo has
nowhere else to live at all — which is also why a dismissed todo, alone
among built-in sources, never ages back out of "done" the way every other
source's dismissals do after 90 days.
```

**Verify**: manually re-read the updated paragraph for sense; no automated
check.

### Step 7: Full verification sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run build`
→ all exit 0.

## Test plan

- `src/store/dismissals.test.ts` — 3 new cases in the existing
  `describe('pruneDismissals', ...)` block, listed in Step 5.
- No new test file; this fits the existing file's scope exactly.
- Verification: `npm test` → all pass, including the 3 new cases.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `dismissals.test.ts` has the 3 new cases from Step
  5, all passing
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "neverExpireDismissals" src/inbox/types.ts src/inbox/sources/todos.ts src/inbox/Inbox.tsx` finds a match in all three files
- [ ] `grep -n "neverExpireSources" src/store/dismissals.ts src/store/useDismissals.ts` finds a match in both files
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pruneDismissals`'s current signature or behavior has changed from the
  "Current state" excerpt above (this plan's whole design rests on adding a
  third parameter to the exact function quoted).
- `InboxSection.tsx`'s confirm flow no longer matches the excerpt quoted in
  "Why this matters" (e.g. if `todos` has since gained a `resolve` — that
  would mean this bug no longer exists, and the plan should be re-evaluated,
  not implemented as-is).
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself wanting to special-case the literal string `'todos'`
  anywhere inside `src/store/dismissals.ts` or `src/store/useDismissals.ts`
  — those files must stay source-agnostic (they take a plain string list, no
  knowledge of which sources exist). The source-specific decision belongs
  only in `src/inbox/sources/todos.ts` (the new field) and `Inbox.tsx` (where
  it's read back out) — if the design in this plan doesn't achieve that
  separation for some reason you discover, stop and report rather than
  hardcoding the exception at the wrong layer.

## Maintenance notes

- Any future built-in source with no `resolve` and no other real completion
  signal (a hypothetical second "personal scratch list" source, say) should
  set `neverExpireDismissals: true` the same way `todos` does now — this is
  the intended extension point, not a one-off.
- A source that later gains a `resolve` should almost certainly *not* set
  this field — once something external can mark it truly done, the TTL's
  "resurface if still unresolved" nudge becomes meaningful for it again the
  same way it already is for drafts and releases.
- This does not change what "mark done" does for a todo (it still only
  dismisses, never deletes) — a reviewer should not expect the Done tab's
  behavior for todos to change at all; only how long a done todo can be
  found there (indefinitely, instead of up to 90 days) changes.
