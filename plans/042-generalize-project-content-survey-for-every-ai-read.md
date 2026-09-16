# Plan 042: Feed every AI read the same automated project survey, not just "Find content gaps"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 87189ec..HEAD -- src/inbox/contentGapsDigest.ts src/inbox/contentGapsDigest.test.ts src/inbox/Inbox.tsx src/inbox/AskInbox.tsx src/ai/promptJson.ts`
> If any of these changed since this plan was written, re-read them in full
> and compare against the excerpts below before proceeding.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (a real, deliberate behavior change to caching/freshness —
  see "The one real trade-off" below; needs a considered STOP-condition
  read before assuming the default choice here is right for every project)
- **Depends on**: none
- **Category**: direction / AI feature (this is the plan the maintainer
  asked for out of the "AI context" design session — see this plan's own
  "Why this matters" for the full framing that produced it)
- **Planned at**: commit `87189ec`, 2026-09-16

## Why this matters

This plugin has four AI reads that ground themselves in "what is this
project, actually": Summarize, Suggest todos, Ask, and Find content gaps.
Today only one of them — Find content gaps — actually reads the dataset
to answer that question. The other three get only whatever's on screen
(row titles) plus the integrator's own optional, static `context` prose
string. Concretely, from `Inbox.tsx`'s own current code:

- `handleSummarize`, `handleSuggestTodos`: `openRows.slice(0, 30).map(...)`
  — on-screen inbox rows only, plus `context ? "About this project: ${context}" : ''`.
- `AskInbox.tsx`'s `handleSubmit`: same shape, `describeRows(rows)` (the
  currently-visible, filtered rows) plus the same optional `context`.
- `handleFindContentGaps`: the only one that also calls
  `surveyContentTypes(client, schema)` — a real, automated read of the
  actual content lake (per-type document counts plus a small sample of
  real text per type) — **and** the same optional `context` prose on top.

The maintainer's own question, verbatim: "how do we make so the Sanity AI
context gets fed in the best way possible, how do we automate as much of
that as possible — reading the content lake is a good start, what more?"
This plan is the concrete answer for the "generalize what already works"
half of that question: `surveyContentTypes` is real, proven, tested code
sitting one file away from three reads that don't use it. It also adds
one more automatable, currently-unused signal (schema field/type
`description`s and the reference graph between types) that costs no
dataset query at all — it's already sitting in the schema object every
one of these reads already has in hand.

**Deliberately not in this plan** (see "Out of scope" and "Direction
options not undertaken here" below): adopting Sanity's own native
`{type: 'groq'}` Agent Actions instruction param instead of this plugin's
own client-side fetch-then-format, and any embeddings/semantic-search
integration. Both are real, promising directions surfaced during this
same design session, but both have genuine unresolved questions (token
cost and answer quality for the first; most projects have no embeddings
index configured at all for the second) that deserve their own
investigation, not a blind adoption bundled into a plan that's otherwise
low-risk.

## Current state

- `src/inbox/contentGapsDigest.ts` — the entire current file (105 lines),
  already read in full this session. Exports: `getRealDocumentTypeNames`
  (every real, creatable document type from the schema, same filter
  `AddMenu.tsx`'s own menu uses), `findSampleFieldName` (first plausibly-
  text field on a type, schema-agnostic), `surveyContentTypes` (per-type
  document count + up to `SAMPLES_PER_TYPE = 5` recent text samples,
  capped at `MAX_SURVEYED_TYPES = 30` types total), and
  `formatContentGapsDigest` (renders the survey as plain text for a
  prompt). All four already have their own tests in
  `contentGapsDigest.test.ts` (read in full — confirm current line/case
  count before extending: `grep -c "  it(" src/inbox/contentGapsDigest.test.ts`).
- `src/inbox/Inbox.tsx:344-345` — `client`/`schema` obtained once per
  component instance:
  ```ts
  const client = useClient({apiVersion: API_VERSION})
  const schema = useSchema()
  ```
  Both are used as `useCallback`/`useMemo` dependencies elsewhere in this
  file already (e.g. `handleFindContentGaps`'s own dependency array,
  `[agentClient, client, schema, context]`) — the existing code already
  treats them as stable-unless-actually-changed values, the same
  assumption this plan's own cache (Step 2) relies on.
- `src/inbox/Inbox.tsx:624-650` (`handleSummarize`), `:667-701`
  (`handleSuggestTodos`), `:717-754` (`handleFindContentGaps`) — all three
  already have the request-generation-ref guard from this session's own
  Plan 032 (`summarizeRequestRef`/`suggestTodosRequestRef`/
  `findContentGapsRequestRef`) — this plan's own new `await` points inside
  these handlers must stay inside that same guard, not bypass it.
- `src/inbox/AskInbox.tsx:44-88` (`handleSubmit`) — same Plan 032 guard
  (`submitRequestRef`), same shape.
- `src/ai/promptJson.ts:93-106` — `promptJson`'s own doc comment (lines
  86-91, already read) explicitly notes `@sanity/client`'s
  `AgentActionParams` shape supports `document | groq | field` params, not
  just plain strings — the exact mechanism the "Direction options not
  undertaken here" section below refers to. Confirmed directly in
  `node_modules/@sanity/client`'s own type definitions
  (`GroqAgentActionParam { type: 'groq'; query: string; params?:
  Record<string, string>; perspective?: ClientPerspective }`, alongside
  sibling `DocumentAgentActionParam`/`FieldAgentActionParam`/
  `ConstantAgentActionParam` — all real, all `@beta`).
- `@sanity/types`' own schema type definitions include a `description?:
  string` property on both type and field definitions (confirmed:
  `node_modules/@sanity/types/lib/index.d.ts`, "A short description of
  what the type or field is used for.") — a real, standard, commonly-used
  Sanity schema convention this codebase's own `test-studio` fixture
  happens not to demonstrate today, but real integrator projects
  routinely do (e.g. `defineField({name: 'body', description: 'SEO-
  optimized long-form content, not internal notes'})`).
- Reference-field detection already has a precedent in this codebase:
  `linkCheckerFindings.ts`'s `singleReferenceTargetType` reads
  `fieldType.to` (an array of `{name: string}`) to find what a reference
  field points at — the same shape this plan's own reference-graph
  extraction (Step 1) reuses, at the type level rather than one specific
  field.
- No embeddings index exists on this plugin's own `test-studio` project
  (confirmed via `list_embeddings_indices` against `efebqg67`/`production`
  during this design session) — real evidence for why semantic search is
  recorded as a "some projects have this, most don't" follow-up rather
  than assumed available.

## The one real trade-off (read before writing Step 2)

`surveyContentTypes` runs a live GROQ read (a `count()` plus a small text
sample) against every real content type, every time it's called — today,
that's once per "Find content gaps" click, always fresh. Generalizing it
to power all four reads means it would otherwise run **four times as
often** if each handler called it independently — wasteful, and slower
per click. The fix this plan uses (Step 2) is a short-TTL cache shared
across all four handlers: a fresh survey happens at most once per 5
minutes of Studio session, not once per click. This is a **deliberate,
real behavior change** for "Find content gaps" specifically: it no longer
guarantees the freshest possible read on every click, only "current as of
the last 5 minutes." For most projects, content doesn't change fast
enough for this to matter; for a very actively-edited dataset mid-session,
it could mean a `contentGaps` suggestion misses something added 90
seconds ago. If this trade-off doesn't sit right, treat it as a STOP
condition and raise it before proceeding, rather than silently shipping a
shorter or longer TTL than what's specified.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|-----------------------|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/inbox/contentGapsDigest.ts` → renamed `src/inbox/projectDigest.ts`
  (the survey now powers every AI read, not just content gaps — the old
  name would actively mislead a future contributor)
- `src/inbox/contentGapsDigest.test.ts` → renamed
  `src/inbox/projectDigest.test.ts`, extended with new cases
- `src/inbox/Inbox.tsx` (`handleSummarize`, `handleSuggestTodos`,
  `handleFindContentGaps`, plus a new shared cache)
- `src/inbox/AskInbox.tsx` (`handleSubmit`) — needs the survey passed in
  as a prop from `Inbox.tsx`, the same way `context` already is, since
  `AskInbox` itself has no direct `client`/`schema` access today
- `README.md` (the existing "Optional: finding content gaps" section, and
  wherever `context`/Summarize/Suggest todos/Ask are documented — update
  to state plainly that these reads now also see an automated survey of
  the project's own content types, not just on-screen rows)

**Out of scope** (recorded below as real follow-ups, not forgotten):
- Adopting Sanity's native `{type: 'groq'}` Agent Actions instruction
  param in place of this plugin's own `client.fetch` + `formatContentGapsDigest`
  text formatting — see "Direction options not undertaken here."
- Any embeddings/semantic-search integration
  (`mcp__Sanity__semantic_search`-shaped retrieval) — most projects have
  no index configured; a real follow-up only once one does.
- Letting `context` itself point to a file or URL instead of an inline
  string — a separate, already-recorded backlog idea
  (`project_context_config_external_source_idea` in this session's own
  memory), unrelated to the automated-survey mechanism this plan builds.
- Any manual "refresh the survey now" affordance — the 5-minute TTL is
  the whole freshness story this plan ships; a manual refresh control is
  a reasonable future addition but adds new UI surface this plan doesn't
  need to justify its own core value.

## Git workflow

- Commits land directly on `main`. Message style: `feat: feed the same
  automated content survey to every AI read, not just content gaps`.
- The file rename (Step 1) is worth its own commit, separate from the
  behavior changes in Steps 2-4 — a rename-only diff is trivial to review
  on its own; bundling it with real logic changes makes both harder to
  read.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Rename the module, and add schema-derived structural facts

Rename `src/inbox/contentGapsDigest.ts` → `src/inbox/projectDigest.ts` and
`src/inbox/contentGapsDigest.test.ts` → `src/inbox/projectDigest.test.ts`
(via `git mv`, so history follows the file). Update the one import site
(`Inbox.tsx`'s `import {formatContentGapsDigest, surveyContentTypes} from
'./contentGapsDigest'`) to the new path. Keep every existing export name
unchanged (`getRealDocumentTypeNames`, `findSampleFieldName`,
`surveyContentTypes`, `formatContentGapsDigest`, `ContentTypeSummary`,
`MAX_SURVEYED_TYPES`) — this step is a pure rename, no behavior change,
verify with a plain diff review before moving on.

**Verify**: `npm run typecheck` → exit 0. `git status` shows the two files
as renames (`R`), not delete+add, if `git mv` was used correctly.

Then, in the (now renamed) `projectDigest.ts`, extend `ContentTypeSummary`
with two new, additive fields:

```ts
export interface ContentTypeSummary {
  type: string
  title: string
  count: number
  samples: string[]
  /** This type's own schema `description`, when the integrator wrote one — real, already-authored editorial intent free for the reading. `undefined` when none exists. */
  description?: string
  /** Other real document types this one references, by title — reveals structure (e.g. "Post references Author, Category") with no extra dataset query, purely from the schema already in hand. */
  referencesTypes: string[]
}
```

Extract the reference-graph walk as its own small, testable function,
mirroring `findSampleFieldName`'s own shape and reusing the same
`fieldType.to` check `linkCheckerFindings.ts`'s `singleReferenceTargetType`
already established as this codebase's own precedent for reading a
reference field's target type:

```ts
/**
 * Every other real document type `typeName`'s own fields reference,
 * deduplicated, by title — same `fieldType.to` shape
 * `linkCheckerFindings.ts`'s `singleReferenceTargetType` already reads
 * for one field; this walks every field on the type instead of one named
 * field, and every target `to` entry rather than requiring exactly one.
 * Top-level fields only, same "v1" limit `findAltEligibleImageFields`
 * (`assetIssues.ts`) already documents for its own schema walk — a
 * reference nested inside an object or array isn't walked here either.
 */
export function findReferencedTypes(
  schema: {get: (name: string) => {fields?: {type: {to?: {name: string}[]}}[]} | undefined},
  realTypesByName: Map<string, string>,
  typeName: string,
): string[] {
  const objectType = schema.get(typeName)
  if (!objectType?.fields) return []

  const titles = new Set<string>()
  for (const field of objectType.fields) {
    for (const target of field.type.to ?? []) {
      const title = realTypesByName.get(target.name)
      if (title) titles.add(title)
    }
  }
  return [...titles]
}
```

Wire both new fields into `surveyContentTypes`'s own per-type loop —
`description` straight from `schema.get(name)?.description`, `referencesTypes`
via `findReferencedTypes(schema, realTypesByNameMap, name)` (build the
`realTypesByName` map once, outside the per-type loop, from the same
`types` list `surveyContentTypes` already computes via
`getRealDocumentTypeNames` — no extra dataset query, this is a pure
schema-object read).

Update `formatContentGapsDigest` to include both, only when present (an
empty `description`/`referencesTypes` shouldn't add empty noise to the
digest text):

```ts
export function formatContentGapsDigest(summaries: readonly ContentTypeSummary[]): string {
  return summaries
    .map((summary) => {
      const count = `${summary.count} document${summary.count === 1 ? '' : 's'}`
      const description = summary.description ? ` — ${summary.description}` : ''
      const references =
        summary.referencesTypes.length > 0 ? ` (references: ${summary.referencesTypes.join(', ')})` : ''
      const samples = summary.samples.length > 0 ? `: ${summary.samples.join(' | ')}` : ''
      return `- ${summary.title} (${count})${description}${references}${samples}`
    })
    .join('\n')
}
```

**Verify**: `npm test -- projectDigest` → all existing cases still pass
unchanged (pure additions to the shape, defaulted/omitted when absent),
plus new cases from Step 5 below.

### Step 2: A short-TTL cache shared across all four reads

In `Inbox.tsx`, add a small cache — a plain module-scope-adjacent
`useRef`, not `useState` (this never needs to trigger a re-render, only to
be read/written across handler calls):

```ts
/** How long a survey stays "fresh enough" before the next read re-runs it — see this plan's own "The one real trade-off" note for why this isn't always-fresh. */
const PROJECT_DIGEST_TTL_MS = 5 * 60 * 1000

const projectDigestCacheRef = useRef<{at: number; promise: Promise<ContentTypeSummary[]>} | null>(null)

const getProjectDigest = useCallback((): Promise<ContentTypeSummary[]> => {
  const cached = projectDigestCacheRef.current
  if (cached && Date.now() - cached.at < PROJECT_DIGEST_TTL_MS) return cached.promise

  const promise = surveyContentTypes(client, schema).catch((error: unknown) => {
    // A failed survey should not be remembered as "fresh" — clear the
    // cache so the next call retries instead of replaying the same
    // rejection for the rest of the TTL window.
    projectDigestCacheRef.current = null
    throw error
  })
  projectDigestCacheRef.current = {at: Date.now(), promise}
  return promise
}, [client, schema])
```

Replace `handleFindContentGaps`'s own direct `surveyContentTypes(client,
schema)` call with `await getProjectDigest()`, and add
`getProjectDigest` to its own `useCallback` dependency array (replacing
the now-redundant direct `client`/`schema` deps, since `getProjectDigest`
itself already depends on and closes over them).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Wire the same survey into Summarize and Suggest todos

In both `handleSummarize` and `handleSuggestTodos`, add the same digest
alongside the existing on-screen-rows digest and the integrator's own
`context` — as a second, clearly-labeled block, not merged into the
existing `digest` variable (keep the on-screen list and the project-wide
survey visually/textually distinct in the prompt, the same way `context`
and the on-screen digest already stay in their own labeled sections
today):

```ts
const handleSummarize = useCallback(async () => {
  const requestId = ++summarizeRequestRef.current
  setSummary({status: 'loading'})
  const digest = openRows
    .slice(0, 30)
    .map((row) => `- ${row.item.title}${row.item.subtitle ? ` (${row.item.subtitle})` : ''}`)
    .join('\n')

  if (!agentClient) {
    if (requestId === summarizeRequestRef.current) setSummary({status: 'error'})
    return
  }

  try {
    const summaries = await getProjectDigest()
    const projectDigest = formatContentGapsDigest(summaries)

    const message = await agentClient.agent.action.prompt({
      instruction:
        (context ? `About this project: ${context}\n---\n` : '') +
        (projectDigest ? `What this project's content actually looks like:\n$survey\n---\n` : '') +
        'Given this list of open inbox items, one per line:\n$items\n---\n' +
        'In two or three short sentences, say what looks most worth starting with first and why.',
      instructionParams: {
        items: digest || 'Nothing is open right now.',
        ...(projectDigest ? {survey: projectDigest} : {}),
      },
    })
    if (requestId === summarizeRequestRef.current) setSummary({status: 'done', message})
  } catch (error: unknown) {
    console.error('[sanity-plugin-structure-inbox] summarize failed', error)
    if (requestId === summarizeRequestRef.current) setSummary({status: 'error'})
  }
}, [agentClient, openRows, context, getProjectDigest])
```

A survey failure here must not fail the whole read — wrap
`getProjectDigest()` in its own try/catch (or rely on the outer one, but
then explicitly fall back to no survey rather than surfacing an error for
what is genuinely optional enrichment):

```ts
let projectDigest = ''
try {
  projectDigest = formatContentGapsDigest(await getProjectDigest())
} catch {
  // Optional enrichment — a failed survey should not fail the whole read.
}
```

Apply the identical pattern to `handleSuggestTodos` (its own instruction
string gets the same `projectDigest` block, same `instructionParams`
merge, same dependency array addition).

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Wire the same survey into `AskInbox`'s `handleSubmit`

`AskInbox` has no direct `client`/`schema` access — pass the already-
formatted digest down as a new, optional prop from `Inbox.tsx` (computed
once via the same `getProjectDigest()` cache, not a second survey
mechanism):

```ts
interface AskInboxProps {
  rows: readonly MergedRow[]
  onSelect: (keys: string[]) => void
  context?: string
  /** The same automated project survey Summarize/Suggest todos/Find content gaps use — see `Inbox.tsx`'s own `getProjectDigest`. Optional: a failed or not-yet-loaded survey just means this question gets asked without it. */
  projectDigest?: string
  result: AskState
  onResultChange: (state: AskState) => void
}
```

In `handleSubmit`, prepend the same labeled block ahead of the existing
`context`/items sections, same pattern as Step 3. In `Inbox.tsx`'s own
`<AskInbox .../>` render site, pass `projectDigest` — resolved once,
lazily, the first time any read needs it (do not force a survey merely
because `ask` is enabled; only compute it when `handleSubmit` actually
runs, same as every other consumer of `getProjectDigest`). This likely
means `AskInbox` itself calls a passed-down `getProjectDigest: () =>
Promise<string>` function prop instead of a pre-resolved string prop —
executor's judgment on whichever shape reads more clearly, as long as the
survey is never fetched speculatively before a question is actually
asked.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Tests

In `projectDigest.test.ts`:
- `findReferencedTypes`: a type with one reference field → returns that
  target's title; a type with a reference to a *hidden* type (filtered
  out of `getRealDocumentTypeNames`) → excluded, not included as a dangling
  reference; a type referencing the same target type from two different
  fields → deduplicated to one entry; a type with no reference fields at
  all → empty array.
- `surveyContentTypes`: a type with a schema `description` → the returned
  summary carries it; a type with none → `description` is `undefined`, not
  an empty string.
- `formatContentGapsDigest`: a summary with both `description` and
  `referencesTypes` → both appear in the formatted line; a summary with
  neither → the line reads exactly as it did before this plan (regression
  case, proves the additions are additive, not disruptive to the existing
  format for a project that uses neither convention).

In `Inbox.test.tsx` (extending the existing suite, likely reusing the
same `promptJsonMock`/module-mock setup this session's own Plan 032
already established there): one new case proving `getProjectDigest`'s
own cache — calling it twice within the TTL window issues only one
underlying `surveyContentTypes`-shaped fetch (mock `client.fetch` and
assert its call count), and a case proving a rejected survey clears the
cache rather than replaying the same rejection on the next call.

**Verify**: `npm test -- projectDigest` and `npm test -- Inbox` → all new
cases pass.

### Step 6: Update `README.md`

Update whichever sections currently describe Summarize/Suggest todos/Ask
and "Optional: finding content gaps" to state plainly that all four reads
now ground themselves in the same automated survey of the project's real
content types (counts, samples, schema descriptions, reference graph),
not just on-screen rows and the integrator's own `context` prose. Keep
the existing `context` explanation as-is — it's still accurate, just no
longer the *only* automated signal.

**Verify**: manually re-read the updated section(s) against this plan's
own Step 3/4 behavior — every claim must trace to real code, not be
aspirational.

### Step 7: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New cases in `projectDigest.test.ts` (Step 5): `findReferencedTypes`
  (4 cases), `description` propagation (2 cases), `formatContentGapsDigest`
  additions (2 cases, including the no-op regression case).
- New cases in `Inbox.test.tsx` (Step 5): cache hit within TTL (1 fetch,
  not 2), cache cleared on rejection.
- Verification: `npm test` → all pass, including every new case.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new case from Step 5 exists and passes
- [ ] `npm run build` exits 0
- [ ] `src/inbox/contentGapsDigest.ts`/`.test.ts` no longer exist;
      `src/inbox/projectDigest.ts`/`.test.ts` do, with git history
      preserved (`git log --follow` on the new path shows the old file's
      history)
- [ ] `handleSummarize`, `handleSuggestTodos`, `handleFindContentGaps`,
      and `AskInbox`'s `handleSubmit` all use the same shared,
      TTL-cached survey — not four independent fetches
- [ ] A failed survey never fails the whole read for any of the four
      handlers — each degrades to "no project digest this time," same as
      a missing `context` already does
- [ ] `README.md` accurately describes the new automated-survey behavior
      for all four reads
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 042 updated

## STOP conditions

- The 5-minute TTL trade-off (see "The one real trade-off" above) doesn't
  sit right once you've thought it through against this specific
  codebase's own `liveQuery$`-everywhere-else convention (every *other*
  read in this pane is live/reactive, never time-cached) — this is a
  real, deliberate exception to that pattern for a good reason (avoiding
  4x the dataset reads per click), but it's worth flagging rather than
  silently accepting if it reads as inconsistent with the rest of the
  codebase's own stated conventions.
- `client`/`schema` (`Inbox.tsx:344-345`) turn out to NOT be stable across
  renders within one mounted Studio session in some case this plan didn't
  anticipate (e.g. a workspace switch remounting `Inbox` with a new
  `client` instance mid-session) — if so, the cache's own `useRef` lives
  and dies with the component instance anyway, so this should self-correct
  on remount, but confirm this reasoning holds before assuming it away.
- A step's verification fails twice after a reasonable fix attempt.

## Direction options not undertaken here (record, don't build)

- **Native `{type: 'groq'}` Agent Actions instruction param, replacing
  this plugin's own `client.fetch` + `formatContentGapsDigest` text
  formatting.** Real and available (confirmed in `@sanity/client`'s own
  types), but genuinely unverified for this use case: would Sanity's own
  server-side formatting of a broad multi-type sample query actually cost
  fewer tokens and read better to the model than this plugin's own
  hand-tuned, capped digest? No evidence either way without a real,
  side-by-side test. Worth a dedicated **investigate-first spike**, not a
  built feature bundled into this plan — same posture this codebase
  already took for Plan 011's nav-badge investigation.
- **Embeddings/semantic search** (`mcp__Sanity__semantic_search`-shaped
  retrieval, real relevance-ranked results instead of "N most recent per
  type"). Confirmed via `list_embeddings_indices` that this plugin's own
  `test-studio` project has none configured — most real integrator
  projects likely don't either, by default. A genuine, real upgrade path
  *if* a project has one, but conditionally available, not universal —
  worth its own future plan once there's a real project to test it
  against, not built speculatively here.
- **`context` accepting a file or URL, not just an inline string** —
  already recorded separately (this session's own
  `project_context_config_external_source_idea` memory); unrelated to the
  automated-survey mechanism this plan builds, since that idea is about
  *how the integrator's own prose gets authored*, not about automating a
  dataset read.

## Maintenance notes

Any future AI read added to this pane should call `getProjectDigest()`
from the start, the same way it should use the request-generation-ref
guard from Plan 032 — both are now the established pattern for a
pane-wide AI read in this file. If the TTL trade-off ever proves wrong in
practice (a real report of stale content-gap suggestions during active
editing), the fix is a shorter TTL or a manual refresh affordance, not
reverting to four independent fetches.
