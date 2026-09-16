# Plan 040: Make source titles (and `openTasks`'s "Overdue"/"Due") actually translatable, not just README-claimed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9c0b227..HEAD -- src/inbox/sources/ src/inbox/Inbox.tsx src/inbox/InboxSection.tsx src/inbox/MergedList.tsx src/i18n/locales/en-US.ts README.md`
> If any of these changed since this plan was written, re-grep for `title =
> '` across `src/inbox/sources/*.ts` before proceeding — a source added or
> removed since could change the exact file list below.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (the one real trade-off — see "A real, narrow risk" below —
  is deliberate and documented, not accidental)
- **Depends on**: none
- **Category**: i18n / docs accuracy
- **Planned at**: commit `9c0b227`, 2026-09-16

## Why this matters

`README.md`'s own "Localization" section says: "Strings live under the
`structureInbox` i18n namespace. Override any of them by registering a
bundle with that namespace." That claim is false for two real, current
cases:

1. **Every one of the 9 built-in sources' default `title`** (`'Draft'`,
   `'Task'`, `'Todo'`, `'Needs fixing'`, etc.) is a plain JS string default
   parameter — never routed through `t()`. There is no i18n key to
   override, so a locale bundle cannot touch it. An integrator using
   default titles in a non-English Studio sees English source titles no
   matter what bundle they register.
2. **`openTasks.ts`'s own `'Overdue'`/`'Due'` subtitle text** is a raw
   string literal inline in a `.map()` callback — not even a configurable
   option, let alone a translation key. Nothing can touch it today.

This plan makes both cases real i18n keys, so the README's own claim
becomes true for the plugin's own built-in strings, not just for strings
an integrator happens to type into `t()` themselves.

## Current state

**Every source's default `title` is a plain literal**, confirmed via
`grep -n "title = '" src/inbox/sources/*.ts`:

| File | Line | Current default |
|---|---|---|
| `assetIssues.ts` | 229 | `title = 'Asset issues'` |
| `linkCheckerFindings.ts` | 288 | `title = 'Link checker'` |
| `needsAttention.ts` | 126 | `title = 'Needs attention'` |
| `documentValidation.ts` | 280 | `title = 'Needs fixing'` |
| `openTasks.ts` | 190 | `title = 'Task'` |
| `todos.ts` | 67 | `title = 'Todo'` |
| `unpublishedDrafts.ts` | 122 | `title = 'Draft'` |
| `upcomingReleases.ts` | 83 | `title = 'Upcoming releases'` |
| `unresolvedComments.ts` | 160 | `title = 'Unresolved comment'` |

Each of these assigns straight into the returned `InboxSource`'s own
`title` field (e.g. `needsAttention.ts:126-130`:
```ts
export function needsAttention(options: NeedsAttentionOptions = {}): InboxSource {
  const {limit = 10, title = 'Needs attention'} = options

  return {
    name: 'needsAttention',
    title,
    ...
```
— identical shape in all 9 files, only the option name/default differs).

**Every consumer of `source.title` renders it as-is**, confirmed via
`grep -rn "\.source\.title\|title={source.title}" src/inbox/*.tsx`:

- `src/inbox/Inbox.tsx:279` (`BoundedSection`'s thrown-error fallback):
  `<SectionCard error={error} title={source.title}>`
- `src/inbox/Inbox.tsx:1016` (the type-filter menu's per-source label):
  `text={report.source.title}`
- `src/inbox/Inbox.tsx:1143` (single-creator "add" button — already
  special-cases `todos`):
  `text={creators[0].source.name === 'todos' ? t('todos.addButton') : creators[0].source.title}`
- `src/inbox/Inbox.tsx:1158` (multi-creator "add" menu item — same
  special-case):
  `text={report.source.name === 'todos' ? t('todos.addButton') : report.source.title}`
- `src/inbox/InboxSection.tsx:128` (the aside card's own header):
  `title={source.title}`
- `src/inbox/MergedList.tsx:673` (a row's own fallback label, when the
  item has no more specific `category`):
  `const category = item.category ?? report.source.title`
- `src/inbox/MergedList.tsx:913` (a source-level error card's own
  heading):
  `{report.source.title}: {report.error?.message ?? t('source.error.title')}`

None of these 7 call sites currently pass `source.title` through `t()`.

**`openTasks.ts`'s inline literal**, `openTasks.ts:238`:
```ts
subtitle: row.dueBy ? (isOverdue(row.dueBy) ? 'Overdue' : 'Due') : undefined,
```
inside a `.pipe(map(...))` callback in `useItems()` — this file does not
currently import or call `useTranslation` at all (confirmed:
`grep -n "useTranslation" src/inbox/sources/openTasks.ts` returns nothing).

**The established, working pattern to copy** — `needsAttention.ts` already
does exactly this (default title aside; its own *subtitle* text is already
correctly translated), confirmed at `needsAttention.ts:137-213`:
```ts
useItems(): InboxSourceResult {
  const client = useClient({apiVersion: API_VERSION})
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  // ...
  const items = useMemo(() => {
    // ...
    subtitle:
      attention === 'ageingUndated'
        ? t('needsAttention.ageingUndated')
        : t(`needsAttention.${attention}`, {when}),
    // ...
  }, [data, counts, t, assignments.byTarget, assigneesById])
```
`t` is included in the `useMemo`'s own dependency array — copy this
exactly for `openTasks.ts`'s equivalent fix.

**A real, narrow risk, deliberately accepted**: the fix below makes every
one of the 7 render call sites call `t(source.title)` unconditionally —
whether `title` is one of this plugin's own default keys (see the new key
table below) or a literal string an integrator passed as their own custom
`title` option. This relies on i18next's own standard behavior: looking up
a key with no matching resource returns the key string itself, unchanged
(already observed empirically in this session's own test suite — see
`Inbox.test.tsx`'s and `MergedList.test.tsx`'s own comments on `t()`
returning the raw key when no i18next instance is registered — the same
"no resource found → return the input" behavior, just for a different
reason). In practice: an integrator's own custom `title: 'My Custom
Drafts'` has no matching resource under `structureInbox`, so `t('My
Custom Drafts')` returns `'My Custom Drafts'` unchanged — it renders
exactly as before. The only way this could go wrong is if an integrator's
own literal title happened to exactly match one of this plugin's real key
strings (e.g. someone genuinely configuring `title:
'source.assetIssues.defaultTitle'` verbatim) — vanishingly unlikely, and
Step 3 below adds a test proving a normal custom title still renders
unchanged.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- All 9 files listed in the table above (default `title` → a real key)
- `src/inbox/sources/openTasks.ts` (the `'Overdue'`/`'Due'` literal → real
  keys, same `useTranslation` pattern `needsAttention.ts` already uses)
- `src/inbox/Inbox.tsx`, `src/inbox/InboxSection.tsx`,
  `src/inbox/MergedList.tsx` (the 7 render call sites — wrap each in `t(...)`)
- `src/i18n/locales/en-US.ts` (new keys)
- `README.md` (the "Localization" section's own claim needs no wording
  change — it's already correctly worded, it's the *implementation* that
  was behind it; but check whether any other README section describes a
  specific source's default title as a literal in a way this plan makes
  stale — e.g. the Options table or a source's own doc section — and fix
  only if you find one)
- Each affected source's own `*.test.ts` (new/updated test cases)
- `src/inbox/Inbox.test.tsx`, `src/inbox/MergedList.test.tsx`,
  `src/inbox/InboxSection.test.tsx` if present (update any assertion that
  currently expects a raw literal title where a key will now render — see
  Step 4)

**Out of scope**:
- Any other per-item text a source generates (e.g. `unresolvedComments`'s
  own thread excerpt, `assetIssues`'s own `ALT_ISSUE_CATEGORY` strings
  from Plan 020) — this plan is scoped to source **titles** and
  `openTasks`'s specific **Overdue/Due** literal only, the two concrete
  cases already confirmed to contradict the README's own claim. A fuller
  i18n audit of every other generated string is a separate, larger
  effort not undertaken here.
- Adding new locale files (e.g. `sv-SE.ts`) — this plan only makes the
  *keys* exist and be overridable; it does not ship a second language.

## Git workflow

- Commits land directly on `main`. Message style: `fix: route default
  source titles and openTasks' Overdue/Due through real i18n keys`.
- Land the 9 source-title changes and the `openTasks` subtitle fix as
  separate commits if that reads more clearly in review, or one combined
  commit — executor's judgment; this is one cohesive fix for one root
  cause (the README's localization claim), not several unrelated ones.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the new keys to `en-US.ts`

Add, grouped together (near the existing `source.*` keys, e.g. right
after `'source.error.retry'` is removed by Plan 034, or wherever the
`source.*` group currently ends):

```ts
// Default titles for the built-in sources — only ever used when an
// integrator has not passed their own `title` option. See Plan 040.
'source.assetIssues.defaultTitle': 'Asset issues',
'source.linkCheckerFindings.defaultTitle': 'Link checker',
'source.needsAttention.defaultTitle': 'Needs attention',
'source.documentValidation.defaultTitle': 'Needs fixing',
'source.openTasks.defaultTitle': 'Task',
'source.todos.defaultTitle': 'Todo',
'source.unpublishedDrafts.defaultTitle': 'Draft',
'source.upcomingReleases.defaultTitle': 'Upcoming releases',
'source.unresolvedComments.defaultTitle': 'Unresolved comment',
```

And, near the existing `needsAttention.*` keys:

```ts
'openTasks.overdue': 'Overdue',
'openTasks.due': 'Due',
```

**Verify**: `npm run typecheck` → exit 0 (no consumer yet, so this alone
can't fail, but confirms the file is still valid).

### Step 2: Change each source's default `title` to its new key

In each of the 9 files, change only the default value — the option name,
type (`string`), and everything else about how `title` flows into the
returned `InboxSource` stays identical:

```ts
// needsAttention.ts, for example:
const {limit = 10, title = 'source.needsAttention.defaultTitle'} = options
```

Repeat for the other 8 files with their own matching key from the table
in Step 1. Do not change how `title` is documented in each file's own
`Options` interface doc comment beyond noting (in one sentence, if not
already implied) that the default is translated automatically and a
custom value is shown exactly as given.

**Verify** (after each file): `npm run typecheck` → exit 0.

### Step 3: Wrap every render call site in `t(...)`

Change each of the 7 call sites found in "Current state" to call
`t(source.title)` (or `t(report.source.title)`, matching whichever
variable is in scope) instead of reading `.title` directly:

- `Inbox.tsx:279` — `BoundedSection`'s `renderFallback` does not currently
  have `t` in scope; add `const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)`
  inside `BoundedSection` itself if not already available in an enclosing
  scope (check first — `Inbox.tsx` likely already calls `useTranslation`
  once near the top of the main `Inbox` component; `BoundedSection` is a
  separate exported component in the same file and may need its own call).
- `Inbox.tsx:1016`, `:1143`, `:1158` — `t` is already in scope in the
  enclosing component (confirmed: these lines already call `t(...)` for
  other keys nearby). Wrap `report.source.title`/`creators[0].source.title`
  in `t(...)`, keeping the existing `todos` special-case ternary
  unchanged (only the fallback branch changes: `: t(report.source.title)`
  instead of `: report.source.title`).
- `InboxSection.tsx:128` — confirm `t` is in scope (it is: this component
  already calls `useTranslation` for other strings — check the top of the
  file). Wrap: `title={t(source.title)}`.
- `MergedList.tsx:673` — `t` is already in scope in this component
  (confirmed: `MergedList.tsx:183`, `const {t} = useTranslation(...)`).
  Change to `const category = item.category ?? t(report.source.title)`.
- `MergedList.tsx:913` — same component, same `t` already in scope:
  `{t(report.source.title)}: {report.error?.message ?? t('source.error.title')}`.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Fix `openTasks.ts`'s inline literal

Add `useTranslation` to `openTasks.ts`'s imports from `'sanity'`, call
`const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)` inside `useItems()`
(same position `needsAttention.ts` uses it, right after `useClient`), and
change:

```ts
subtitle: row.dueBy ? (isOverdue(row.dueBy) ? 'Overdue' : 'Due') : undefined,
```

to:

```ts
subtitle: row.dueBy ? (isOverdue(row.dueBy) ? t('openTasks.overdue') : t('openTasks.due')) : undefined,
```

Add `t` to whichever `useMemo`'s dependency array wraps this — check the
enclosing scope first (it may already be inside a `map()` inside a
`.pipe()`, not a `useMemo`, in which case `t` needs to be captured in that
callback's own closure, which requires no dependency array at all since
it's not a memoized value — confirm which shape applies before editing).

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Update existing tests, add new ones

Any existing test asserting a raw literal default title (e.g.
`getByText('Draft')`, `getByText('Task')`) will now see the *translation
key itself* instead, in a test environment with no real i18next instance
registered — same behavior this session's own Plan 032 already
documented and relied on (`Inbox.test.tsx`'s own comment: "no real
i18next instance in this suite... the accessible name is the untranslated
key, not the English copy"). Find every such assertion via `grep -rn
"'Draft'\|'Task'\|'Todo'\|'Needs fixing'\|'Asset issues'\|'Link
checker'\|'Needs attention'\|'Upcoming releases'\|'Unresolved comment'"
src/**/*.test.tsx` and update each to expect the new key string instead
(e.g. `'source.unpublishedDrafts.defaultTitle'`), matching the existing
convention in `MergedList.test.tsx`/`Inbox.test.tsx`.

Also add, in `src/inbox/sources/openTasks.test.ts` (or wherever its own
test file is): a case confirming an overdue task's `subtitle` is
`'openTasks.overdue'` (the raw key, matching this suite's own established
no-i18next convention) and a not-yet-due one is `'openTasks.due'`.

And, per the "real, narrow risk" section above: add one test (in
whichever source's test file is easiest, e.g. `unpublishedDrafts.test.ts`)
confirming that a **custom** `title` option (e.g. `title: 'My Custom
Drafts'`) is passed straight through unchanged as `InboxSource.title` — no
change needed to prove this at the source-factory level (the value is
just held, not translated, until render), so this can be a simple
assertion on the returned `InboxSource.title` field, matching whatever
existing tests for `title` overrides already look like in that file.

**Verify**: `npm test` → all pass, no assertions broken by the switch from
literal text to key text in the (real-i18next-less) test environment.

### Step 6: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- Updated assertions in every existing test that checked a raw default
  title string, now checking the new key string instead (Step 5).
- New case(s) in `openTasks.test.ts` for the `Overdue`/`Due` subtitle
  fix.
- New case confirming a custom `title` override still renders as given,
  unaffected by the `t(...)` wrapping at render call sites.
- Verification: `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every updated/new test from Step 5 passes
- [ ] `npm run build` exits 0
- [ ] `grep -n "title = '[A-Z]" src/inbox/sources/*.ts` returns nothing
      (no source default title is still a bare display string — every one
      is now a `source.*.defaultTitle` key)
- [ ] `grep -n "'Overdue'\|'Due'" src/inbox/sources/openTasks.ts` returns
      nothing (both are now `t('openTasks.overdue')`/`t('openTasks.due')`)
- [ ] All 7 render call sites listed in "Current state" call `t(...)` on
      the source title before displaying it
- [ ] A custom `title` option, when configured, still renders exactly as
      given (proven by the new test from Step 5)
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 040 updated

## STOP conditions

- Any of the 9 source files' default `title` is consumed somewhere other
  than the 7 render call sites already listed (e.g. used to build an id,
  a dismissal key, or anything else where translating it would change
  behavior beyond display text) — check every usage of that source's own
  `title` variable before assuming it's display-only. `report.source.name`
  (not `.title`) is what's used for ids/keys everywhere already confirmed
  in this codebase's own conventions, but confirm per-file rather than
  assume.
- `BoundedSection` (`Inbox.tsx:274-298`) cannot call `useTranslation`
  without breaking its own stated test-isolation reason for existing
  separately from the main `Inbox` component (its own doc comment:
  exported specifically so a unit test can render it "without also
  mounting `useDismissals`'s `useClient`, which needs a full Studio source
  context") — if adding `useTranslation` there turns out to need more
  Studio context than a plain `useTranslation()` call needs (it
  shouldn't; `useTranslation` needs only an i18n context, already proven
  cheap in every other component in this file), STOP and report rather
  than widening that component's own test-isolation contract silently.

## Maintenance notes

Any new built-in source should default its `title` to a
`source.<name>.defaultTitle` key from the start, following this plan's own
naming convention, rather than a bare literal — this is now the
established pattern, and the README's "override any of them" claim only
stays true if every future default follows it too.
