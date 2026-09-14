# Plan 013: Bulk "save a copy to my todos" selection action

> **Executor instructions**: Follow steps in order. Every step ends in a
> verification command — run it before moving to the next step. If a STOP
> condition below is met, stop and report back instead of improvising. When
> done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat decd612..HEAD -- src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx src/i18n/locales/en-US.ts`
> (Re-stamped 2026-09-13: the original `2218e06` baseline predated a large
> commit, `decd612`, that landed exactly the assignee/todo-edit/undo-toast
> code this plan's "Current state" already quotes — a first execution
> attempt against `2218e06` correctly stopped on real excerpt mismatches.
> `decd612` now matches the excerpts below; verified directly.)
> If any in-scope file changed since this plan was written, re-read it and
> compare against the "Current state" excerpts below before proceeding; on a
> real mismatch (not just line-number drift), treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive UI action; no existing capability is changed)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2218e06`, 2026-09-13 (re-stamped against `decd612`,
  2026-09-13 — see drift-check note above)

## Why this matters

`src/inbox/MergedList.tsx` already has two "plugin-level" bulk capabilities
that apply to a mixed-source selection regardless of which source each row
came from: mark-done/snooze. The snooze one says so directly, in a comment
right where it's computed:

```tsx
// src/inbox/MergedList.tsx:162
/** Snoozing is a plugin-level capability, not a per-source one — every item can be, regardless of where it came from. */
```

`assign`, by contrast, is deliberately gated to a *single-source* selection,
because different sources have different assignee pools:

```tsx
// src/inbox/MergedList.tsx:189-195
// Only offered when every selected row shares one source, and that source
// actually offers `assign`: assigning across sources with different
// assignee pools has no single well-defined meaning.
const assignableSource =
  selected.length > 0 && selected.every((row) => row.sourceName === selected[0].sourceName)
    ? reports[selected[0].sourceName]?.assign
    : undefined
```

There's a third shape of bulk action this pane doesn't have yet, and it
falls closer to snooze's category than assign's: **"remember this, across
whatever source it came from."** An editor triaging a merged list of drafts,
tasks and releases has no way to say "I can't deal with this now, but I want
a personal reminder about it" without leaving the source item itself alone —
snoozing hides it, marking done dismisses it, and neither one produces a
standalone note the editor can add their own context to. The `todos` source
already exists for exactly that personal-reminder need
(`src/inbox/sources/todos.ts`) — the value being added here is a bridge:
letting *any* row become one, not just typed-from-scratch todos, without
inventing a new store or a new concept.

This works with the grain of the code already, because `create` is not
special to the `todos` source — it's a capability any `InboxSource` can
declare (`src/inbox/types.ts:113-121`), and `MergedList.tsx` already
collects every source offering it into one list, for the "add one" row:

```tsx
// src/inbox/MergedList.tsx:236-238
// `update` too, not just `create`: the same dialog hosts both, and a
// source could in principle offer editing without offering creation.
const creators = reportsInOrder.filter((r) => r.create || r.update)
```

`InboxItem` already carries `title`/`description`/`dueBy` fields
(`src/inbox/types.ts:24-78`), and `CreateItemInput` — what `create` accepts —
is exactly `{title, description?, dueBy?}` (`src/inbox/types.ts:86-91`). An
`InboxItem` is already shape-compatible with a `CreateItemInput`; no new
plumbing is needed to turn one into the other.

## Current state

**`src/inbox/types.ts:86-172`** — `CreateItemInput` and the relevant slice of
`InboxSourceResult`:

```ts
export interface CreateItemInput {
  title: string
  description?: string
  dueBy?: string
}

export interface InboxSourceResult {
  items: InboxItem[]
  // ...
  create?: (input: CreateItemInput) => Promise<void> | void
  // ...
}
```

**`src/inbox/MergedList.tsx:189-231`** — the existing `assign` gating and its
`confirmAssign` handler, the closest existing pattern to model the new action
on (single mutation fired per selected row via `Promise.allSettled`, cleared
selection, undo-toast on success):

```tsx
const assignableSource =
  selected.length > 0 && selected.every((row) => row.sourceName === selected[0].sourceName)
    ? reports[selected[0].sourceName]?.assign
    : undefined

const confirmAssign = useCallback(
  async (userId: string) => {
    if (!assignableSource) return
    const targets = [...selected]
    const assignee = assignableSource.users.find((user) => user.id === userId)?.label ?? userId

    setBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((row) => assignableSource.toUser(row.item, userId)),
      )

      let assignedCount = 0
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('[sanity-plugin-structure-inbox] could not assign item', result.reason)
        } else {
          assignedCount += 1
        }
      })

      setSelectedKeys([])

      if (assignedCount > 0) {
        showUndoToast({title: t('undo.assigned', {count: assignedCount, name: assignee})})
      }
    } finally {
      setBusy(false)
    }
  },
  [assignableSource, selected, showUndoToast, t],
)
```

**`src/inbox/MergedList.tsx:236-238`** — `creators`, already computed once per
render, the list this plan reuses:

```tsx
const creators = reportsInOrder.filter((r) => r.create || r.update)
```

**`src/inbox/SelectionActions.tsx:1-38`** (imports and the props interface) —
the bar's existing optional-capability props, the pattern to extend:

```tsx
interface SelectionActionsProps {
  count: number
  view: InboxView
  resolves: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  onSnooze?: (preset: SnoozePreset) => void
  assignableUsers?: {id: string; label: string}[]
  onAssign?: (userId: string) => void
}
```

**`src/inbox/SelectionActions.tsx:110-139`** — how `onSnooze`/`onAssign` each
render their own control conditionally, side by side, in the same wrapping
`Flex`:

```tsx
<Flex align="center" gap={2} paddingLeft={2} wrap="wrap">
  {onSnooze && (
    <Box>
      <Select fontSize={1} onChange={handleSnoozeChange} value="">
        {/* ... */}
      </Select>
    </Box>
  )}

  {onAssign && assignableUsers && assignableUsers.length > 0 && (
    <Box>
      <Select fontSize={1} onChange={handleAssignChange} value="">
        {/* ... */}
      </Select>
    </Box>
  )}

  <Button /* confirm button */ />
</Flex>
```

**`src/i18n/locales/en-US.ts:53-59`** — the existing `action.*` key block this
plan's new key joins:

```ts
'action.snooze': 'Snooze',
'action.snooze.laterToday': 'Later today',
'action.snooze.tomorrow': 'Tomorrow',
'action.snooze.nextWeek': 'Next week',

'action.assign': 'Assign to…',
'action.delete': 'Delete',
```

## Scope

**In scope**:
- `src/inbox/MergedList.tsx` — add a `soleCreator` value derived from the
  existing `creators` array, and a `confirmSaveToTodos` handler.
- `src/inbox/SelectionActions.tsx` — add an `onSaveToTodos?: () => void` prop
  and its button.
- `src/i18n/locales/en-US.ts` — new key(s) for the button label and the
  undo-toast message.
- `src/inbox/MergedList.test.tsx` — new test cases.

**Out of scope**:
- `src/inbox/sources/todos.ts`, `src/store/useTodos.ts`, `src/store/todos.ts`
  — the `todos` source and its store are consumed as-is via `report.create`;
  nothing about how todos are stored changes.
- `src/inbox/CreateItemRow.tsx` — the single-item add/edit dialog is
  unrelated; this plan adds no dialog, since a bulk action reuses each
  selected row's own existing title/description/dueBy with no editing step.
- Any change to `InboxSource`/`InboxSourceResult`/`CreateItemInput` in
  `src/inbox/types.ts` — this plan needs no new type, only new call sites for
  the existing `create` capability.
- Gating this action to a *single* creator only (see Step 1) — supporting a
  picker across multiple configured creator sources is explicitly deferred,
  see STOP conditions.

## Git workflow

- Branch: `advisor/013-bulk-save-to-todos`
- Commit per step; message style matches `git log` — imperative, lowercase
  type prefix, e.g. `feat: add bulk "save to todos" selection action`.
- Do NOT push or open a PR unless the operator instructed it.

## Commands you will need

| Purpose   | Command                    | Expected on success |
|-----------|-----------------------------|----------------------|
| Install   | `npm install`                | exit 0 |
| Typecheck | `npm run typecheck`          | exit 0, no errors |
| Test      | `npm run test`               | exit 0, all tests pass |
| Lint      | `npm run lint`               | exit 0, no errors |
| Build     | `npm run build`              | exit 0, `dist/` produced |

## Steps

### Step 1: Add `soleCreator` and `confirmSaveToTodos` to `MergedList.tsx`

Directly below the existing `creators` line (`MergedList.tsx:238`), add:

```tsx
// Offered only when exactly one configured source can create items: with
// two or more, "save to todos" would be ambiguous about which list a copy
// goes into, the same reasoning `assign` already applies to a mixed-source
// selection.
const soleCreator = creators.length === 1 ? creators[0] : undefined
```

Then, near `confirmAssign` (after it, before `reportsInOrder`), add:

```tsx
const confirmSaveToTodos = useCallback(async () => {
  if (!soleCreator?.create) return
  const targets = [...selected]

  setBusy(true)
  try {
    const results = await Promise.allSettled(
      targets.map((row) =>
        soleCreator.create!({
          title: row.item.title,
          description: row.item.description,
          dueBy: row.item.dueBy,
        }),
      ),
    )

    let savedCount = 0
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('[sanity-plugin-structure-inbox] could not save item to todos', result.reason)
      } else {
        savedCount += 1
      }
    })

    setSelectedKeys([])

    if (savedCount > 0) {
      showUndoToast({title: t('undo.savedToTodos', {count: savedCount})})
    }
  } finally {
    setBusy(false)
  }
}, [soleCreator, selected, showUndoToast, t])
```

Wire it into the `<SelectionActions>` call (`MergedList.tsx:317-328`),
alongside the existing `onAssign`/`onSnooze` props — same `view === 'open'`
gate they both use:

```tsx
onSaveToTodos={view === 'open' && soleCreator ? confirmSaveToTodos : undefined}
```

**Verify**: `npm run typecheck` — exit 0. (No behavior to observe yet; the
prop doesn't render until Step 2.)

### Step 2: Add the button to `SelectionActions.tsx`

Add to `SelectionActionsProps`:

```tsx
/** Offers "Save to todos". Only meaningful in the open view, same reasoning as `onSnooze`. */
onSaveToTodos?: () => void
```

Render it as a plain `Button` (not a `Select` — this action needs no choice,
unlike snooze/assign), placed between the snooze/assign controls and the
final confirm button in the same `Flex` (`SelectionActions.tsx:110-139`):

```tsx
{onSaveToTodos && (
  <Button
    disabled={busy}
    fontSize={1}
    mode="bleed"
    onClick={onSaveToTodos}
    padding={2}
    text={t('action.saveToTodos')}
  />
)}
```

Destructure `onSaveToTodos` from `props` alongside the other optional
capabilities at the top of the component.

**Verify**: `npm run typecheck` — exit 0.

### Step 3: Add the i18n keys

In `src/i18n/locales/en-US.ts`, add to the `action.*` block:

```ts
'action.saveToTodos': 'Save to todos',
```

And to the `undo.*` block:

```ts
'undo.savedToTodos_one': '{{count}} saved to your todos',
'undo.savedToTodos_other': '{{count}} saved to your todos',
```

(Match the existing `_one`/`_other` pluralization pattern used by
`undo.markedDone`/`undo.snoozed` immediately above it.)

**Verify**: `npm run typecheck` — exit 0 (catches a missing/misspelled key if
`en-US.ts`'s type is used elsewhere as the canonical key set — check for a
`Record<TranslationKey, string>` style assertion at the bottom of the file
first; if none exists, this step has no type-level check and Step 4's test
is the real verification).

### Step 4: Tests in `MergedList.test.tsx`

Follow the existing fixture pattern at the top of the file (`item()`,
`source()`, `report()`, `renderList()`, `selectItem()`). Add:

1. **Offers "Save to todos" only when exactly one source has `create`** —
   render with two reports, one with `create: vi.fn()` (mirroring how the
   real `todos` source reports it), select a row from *either* source,
   assert the button (`screen.getByText('Save to todos')` /
   `queryByText(...)`) appears.
2. **Does not offer it when zero or two+ sources have `create`** — same
   setup with `create` on none, then on both reports; assert
   `screen.queryByText('Save to todos')` is `null` in both cases.
3. **Clicking it calls the creator's `create` with each selected row's
   title/description/dueBy, regardless of which source the row came from** —
   select rows from two different (non-creator) sources plus one from the
   creator source itself; click "Save to todos"; assert `create` was called
   once per selected row with the right `{title, description, dueBy}`.
4. **Selection clears and an undo toast fires with the right count** —
   mirror the existing assign test's assertions (find it by searching this
   file for the current `describe('MergedList'` block's assign-related
   `it(...)`, and match its toast-assertion style exactly).

**Verify**: `npm run test -- MergedList` — exit 0, all new cases pass.

### Step 5: Full verification sweep

Run every command in the table above, in order. All must exit 0.

## Test plan

Covered in Step 4 above — four new cases in `src/inbox/MergedList.test.tsx`,
following that file's existing fixture and assertion style exactly (no new
test utilities needed).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0, including the 4 new `MergedList.test.tsx` cases
- [ ] `npm run build` exits 0
- [ ] `grep -n "onSaveToTodos" src/inbox/MergedList.tsx src/inbox/SelectionActions.tsx` finds matches in both files
- [ ] `grep -n "action.saveToTodos" src/i18n/locales/en-US.ts` finds a match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A Studio configuration with more than one `create`-offering source turns
  out to be common enough that "only offer this with exactly one creator"
  feels too limiting in practice — that's a product decision (a source
  picker in the button, or a dropdown like snooze/assign use) for a
  follow-up plan, not something to improvise here.
- `soleCreator.create` throws synchronously instead of returning a rejected
  promise for some existing source — `Promise.allSettled` around a
  synchronous throw inside `.map()` would abort the whole `.map()` before
  `allSettled` ever runs; if you observe this see whether wrapping each call
  in `Promise.resolve().then(() => soleCreator.create!(...))` is warranted,
  but don't change how any *existing* capability (`assign`, `resolve`) is
  invoked to "fix" this — those are out of scope.
- Any existing test in `MergedList.test.tsx` starts failing after Step 1 or
  2, before you've written the new tests — that means the drift check at the
  top of this plan missed something; stop rather than adjusting existing
  tests to pass.

## Maintenance notes

- If a later plan adds a second built-in source with `create` (todos plus
  something else), `soleCreator` becomes `undefined` in Studios configuring
  both, silently hiding this button — that's the documented, deliberate
  behavior above, but flag it to whoever writes that plan so they can decide
  whether to extend this action rather than leave it quietly disabled.
- This bulk action never touches the *selected* row's own source — it only
  ever calls the creator source's `create`. A reviewer should not expect the
  original item (a draft, a task) to change state at all when this runs;
  that's intentional, not a missing dismiss/resolve call.
