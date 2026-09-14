# Plan 002: Stop a slow dismissals load from discarding a tick

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 30e3782..HEAD -- src/store/useDismissals.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e3782`, 2026-09-09

## Why this matters

`useDismissals` holds the editor's "done" list in React state, updates it
optimistically on a tick, and persists it from an effect. Two independent
effects — one that loads the stored value, one that saves it — can interleave
badly, and the result is silent data loss.

The sequence, all inside the initial fetch window:

1. The component mounts and the load effect issues its fetch.
2. The editor ticks item **A** before it resolves. `dirtyRef` is set, state
   updates, the persist effect writes `{A}` to the server and clears `dirtyRef`.
3. The fetch — issued *before* that write — resolves with the old server value
   and calls `setState`, replacing local state and dropping **A** from the UI.
   `dirtyRef` is now `false`, so nothing re-persists.
4. The editor ticks item **B**. State is now `server + B`, with **A** missing.
   That is what gets written.

**A's dismissal is permanently gone.** The window is narrow but it is exactly
when an eager editor clicks on a slow connection, and there is no log line to
explain it afterwards. There is a second, blunter path to the same place: if
the *read* fails outright (`:86-92` logs and moves on, leaving state empty), the
next tick writes a one-entry object over whatever the editor had accumulated —
up to 90 days of dismissals across every source.

## Current state

Single file: `src/store/useDismissals.ts`. Its two effects, verbatim
(`:74-120`):

```ts
  useEffect(() => {
    if (!documentId) return undefined

    let cancelled = false

    client
      .fetch<string | null>(`*[_id == $id][0].${DISMISSALS_FIELD}`, {id: documentId})
      .then((raw) => {
        if (!cancelled && typeof raw === 'string') setState(parseDismissals(JSON.parse(raw)))
        return undefined
      })
      .catch((error: unknown) => {
        // A missing document is the normal first-run case and resolves to
        // `null` rather than throwing, so anything landing here is a real
        // failure — and an inbox showing everything beats one that will not
        // render.
        console.error('[sanity-plugin-structure-inbox] could not read dismissals', error)
      })

    return () => {
      cancelled = true
    }
  }, [client, documentId])

  // Persisting in an effect rather than inside the click handler keeps the
  // stored value derived from the state that actually rendered. A handler
  // would have to guess it, because a `setState` updater does not run until
  // React re-renders.
  useEffect(() => {
    if (!dirtyRef.current || !documentId) return

    dirtyRef.current = false

    const value = JSON.stringify(state)

    client
      .transaction()
      .createIfNotExists({_id: documentId, _type: DISMISSALS_TYPE, [DISMISSALS_FIELD]: value})
      .patch(documentId, (patch) => patch.set({[DISMISSALS_FIELD]: value}))
      .commit({visibility: 'async'})
      .catch((error: unknown) => {
        console.error('[sanity-plugin-structure-inbox] could not save dismissals', error)
      })
  }, [client, documentId, state])
```

`dirtyRef` is declared at `:71`:

```ts
  const dirtyRef = useRef(false)
```

and set in `update` (`:122-129`), which is what `dismiss`/`restore` call.

The pure helpers this plan reuses live in `src/store/dismissals.ts`:
`EMPTY_DISMISSALS`, `parseDismissals`, `pruneDismissals`, `withDismissal`,
`withoutDismissal`, and the `DismissalState` shape
`{version: 1, dismissed: Record<string, Record<string, string>>}` where the
inner value is an ISO timestamp. Read that file before starting.

Repo conventions:
- Comments explain *why*, in full sentences. Match the density already in this
  file — it is the house style, not decoration.
- Pure logic belongs in `dismissals.ts` with unit tests in
  `dismissals.test.ts`; the hook stays thin.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit -p tsconfig.json`        | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass            |
| Lint      | `npm run lint`                             | exit 0, no output   |
| Build     | `npm run build`                            | `[success]`         |

## Scope

**In scope**:
- `src/store/useDismissals.ts`
- `src/store/dismissals.ts` (only to add a merge helper)
- `src/store/dismissals.test.ts` (tests for that helper)

**Out of scope** (do NOT touch):
- `src/inbox/InboxSection.tsx` and everything else that calls `dismiss`/
  `restore` — the hook's public shape (`{state, dismiss, restore}`) must not
  change.
- `src/store/dismissals.ts`'s `isDismissed` — plan 001 changes it; do not touch
  it here.
- The document id derivation at `:37-40`, and the JSON-string-in-one-field
  storage choice — both deliberate and out of scope.

## Git workflow

- Branch: `advisor/002-dismissals-load-race`
- Conventional commits, e.g. `fix: do not let a late dismissals load drop a tick`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a pure merge helper to `dismissals.ts`

Add an exported `mergeDismissals(a: DismissalState, b: DismissalState): DismissalState`
that returns the union of both `dismissed` maps, and where the same
`source`+`itemId` appears in both, keeps the **later** ISO timestamp. An
unparseable timestamp loses to a parseable one. Keep it pure and total — no
throwing on malformed input, consistent with `parseDismissals` next to it.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 2: Track whether the stored value has been read

In `useDismissals`, add a ref recording load status, e.g.
`const loadedRef = useRef(false)`. Set it to `true` in the load effect's
`.then()` **on every settled read, including `raw === null`** (a missing
document is a successful read of "nothing"), and leave it `false` when the
`.catch()` fires.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0.

### Step 3: Merge a late load instead of replacing state

In the load effect's `.then()`, when the parsed server value arrives:

- If `dirtyRef.current` is `false` **and** no local change has been made yet,
  `setState(parsed)` as today.
- Otherwise the editor has already changed something, so
  `setState((current) => mergeDismissals(parsed, current))` — the local value
  wins ties because it is newer.

Then, if `dirtyRef.current` was set, leave it set so the persist effect runs
again on the merged state and the server ends up with the union.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0 and `npx vitest run` →
still green.

### Step 4: Refuse to persist over a failed read

In the persist effect, add `loadedRef.current` to the early-return guard, so a
read that outright failed can never be followed by a blind full-document
overwrite:

```ts
    if (!dirtyRef.current || !documentId || !loadedRef.current) return
```

Important: do **not** clear `dirtyRef` when bailing out for this reason —
otherwise the tick is dropped instead of deferred. Move the
`dirtyRef.current = false` assignment to after the guard, which is where it
already is; just confirm the new condition does not skip past it.

Add a comment explaining that a failed read means the in-memory state is not a
superset of the stored state, so writing it would destroy dismissals this
session never saw.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npm run lint` → exit 0.

### Step 5: Tests

See the Test plan.

**Verify**: `npx vitest run` → all pass.

## Test plan

The hook itself needs a renderer and a fake client, which plan 007 sets up. For
**this** plan, test the pure helper only — do not build a renderer harness here.

Add to `src/store/dismissals.test.ts`, following the existing `describe` style:

- `mergeDismissals` unions two disjoint sources.
- Same source, different item ids: both survive.
- Same source and item id in both: the later timestamp wins, whichever
  argument it came from.
- An unparseable timestamp on one side loses to a parseable one.
- Merging with `EMPTY_DISMISSALS` in either position returns the other
  unchanged.

**Verification**: `npx vitest run src/store/dismissals.test.ts` → all pass with
at least 5 new tests.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest run` exits 0 with at least 5 new `mergeDismissals` tests
- [ ] `grep -n "loadedRef" src/store/useDismissals.ts` shows the guard in the
      persist effect
- [ ] The exported hook shape is unchanged:
      `grep -n "return useMemo(() => ({state, dismiss, restore})" src/store/useDismissals.ts`
      still matches
- [ ] `npm run build` prints `[success]`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The two effects in `src/store/useDismissals.ts` do not match the excerpt above.
- You find yourself needing to change `InboxSection.tsx` or any caller — the
  hook's contract is meant to be unchanged by this plan.
- Adding the `loadedRef` guard makes an existing test fail. Nothing currently
  tests this hook, so a failure means something is coupled in a way this plan
  did not anticipate.
- You conclude the correct fix is to abandon the effect-based persistence and
  write inside the click handler. That is a larger design change; report rather
  than doing it.

## Maintenance notes

- The persist effect is keyed on `state`, so anything that makes `state`
  change identity without a real edit will cause spurious writes. `dirtyRef`
  is the only thing preventing that; keep it.
- A reviewer should specifically check that `dirtyRef` is never cleared on a
  path that does not actually write.
- Deferred: cross-tab/cross-device concurrent edits still resolve
  last-write-wins at the document level. The merge added here only reconciles
  this session's load against this session's edits. Fixing the wider case needs
  a real-time listener and is out of scope.
