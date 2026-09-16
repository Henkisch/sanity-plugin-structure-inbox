# Plan 042: Feed Ask (and Find content gaps) the same automated project survey, and make it scale

> **Revised after review** (still commit `87189ec`, before execution): the
> original draft wired this survey into all four AI reads. Scoped down to
> two — see "Why only Ask, not Summarize/Suggest todos" below — and this
> revision adds a real "at scale" pass (bounded concurrency, and an honest
> note on where the sampling heuristic itself stops working) prompted by
> a direct question: "picture a project with 1000s of documents."

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
- **Effort**: M (narrowed from the original L — two reads, not four; see
  below)
- **Risk**: MED (a real, deliberate behavior change to caching/freshness —
  see "The one real trade-off" below — plus real scale unknowns flagged in
  "At scale" that should be checked against a real large dataset, not just
  `test-studio`'s small one, before trusting the defaults here)
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
sitting one file away from a read that doesn't use it. It also adds one
more automatable, currently-unused signal (schema field/type
`description`s and the reference graph between types) that costs no
dataset query at all — it's already sitting in the schema object this
read already has in hand.

### Why only Ask, not Summarize/Suggest todos

The original draft of this plan wired the survey into all four reads.
Reviewed before execution and narrowed: **Summarize and Suggest todos are
about the current open queue** — "what's worth starting first," "what
should I add to my list" — and both already get that queue in full
(`openRows.slice(0, 30)`). A project-wide survey (document counts across
every type, samples from types that may have nothing to do with what's
currently open) doesn't obviously sharpen either judgment call, and it
adds a real, non-trivial fetch to two reads that are fast today. That's
the opposite of the advice this same design session landed on for the
`context` string itself: concrete and short beats a wall of restated
facts. **Ask is different**: "things about the spring campaign" is
explicitly a broader question than the on-screen rows — it's the one
read whose whole point is reasoning past what's currently visible, so the
survey earns its cost there. Find content gaps already pays this cost by
design (it's a whole-project judgment call, always was) — this plan adds
the same free schema-derived facts to that read too, and makes the
underlying fetch itself scale better (see "At scale" below), but doesn't
change what it already does conceptually.

If Summarize/Suggest todos genuinely turn out to want this later, revisit
then — with real user reports pointing at a real gap in output quality,
not extended speculatively now.

**Deliberately not in this plan** (see "Out of scope" and "Direction
options not undertaken here" below): adopting Sanity's own native
`{type: 'groq'}` Agent Actions instruction param instead of this plugin's
own client-side fetch-then-format, and any embeddings/semantic-search
integration. Both are real, promising directions surfaced during this
same design session, but both have genuine unresolved questions (token
cost and answer quality for the first; most projects have no embeddings
index configured at all for the second) that deserve their own
investigation, not a blind adoption bundled into a plan that's otherwise
low-risk. At real scale, the embeddings direction in particular stops
being a "nice to have if configured" and starts being the actually-right
answer — see "At scale" below.

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
that's once per "Find content gaps" click, always fresh. Sharing it with
Ask means it would otherwise run **twice as often** if each read called it
independently — wasteful, and slower per click, especially once Step 1a's
own concurrency work is in place and each survey is genuinely doing more
work per call, not less. The fix this plan uses (Step 2) is a short-TTL
cache shared between both reads: a fresh survey happens at most once per
5 minutes of Studio session, not once per click. This is a **deliberate,
real behavior change** for "Find content gaps" specifically: it no longer
guarantees the freshest possible read on every click, only "current as of
the last 5 minutes." For most projects, content doesn't change fast
enough for this to matter; for a very actively-edited dataset mid-session,
it could mean a `contentGaps` suggestion misses something added 90
seconds ago. If this trade-off doesn't sit right, treat it as a STOP
condition and raise it before proceeding, rather than silently shipping a
shorter or longer TTL than what's specified.

## At scale (a project with 1000s of documents, not `test-studio`'s handful)

Three real things change once the dataset is actually big, checked
directly against `surveyContentTypes`'s current implementation:

1. **Token/prompt cost stays flat regardless of dataset size** — good,
   already true by design. `SAMPLES_PER_TYPE = 5` and
   `MAX_SURVEYED_TYPES = 30` are fixed caps, not proportional to document
   count; a project with 50 documents and one with 50,000 produce a
   survey of the same shape and roughly the same size. Nothing to change
   here.
2. **The fetch itself does not stay flat, and it was already the risk
   even at small scale.** `surveyContentTypes`'s own per-type loop is
   explicitly **sequential** — one `await` at a time, with the file's own
   comment defending this as "simpler than a worker pool for a cap this
   low." At `MAX_SURVEYED_TYPES = 30`, a big real project (bigger
   projects tend to have *more* content types, not fewer) will routinely
   hit that cap, meaning up to 30 sequential `count()` calls plus up to 30
   more sequential sample fetches — up to 60 sequential network
   round-trips before the survey resolves. Each round-trip's latency is
   mostly fixed overhead (connection + response time), not proportional
   to how many documents exist — so this cost is really about *type
   count*, not *document count*, but a big project usually has both. This
   plan's own **Step 1a** (below) fixes this with bounded concurrency
   instead of a fully sequential loop.
3. **The sampling heuristic itself gets weaker as a project grows, and
   this plan should say so honestly rather than pretend otherwise.** "5
   most recent documents" out of 20 is a meaningful fraction of a small
   project; "5 most recent" out of 3,000 can just be whatever a single
   recent campaign happened to produce — not representative of what the
   project actually contains. This isn't a new problem this plan
   introduces (contentGaps already has it today), but it means the real
   value of automated sampling *degrades* exactly where automation would
   matter most. This is the concrete reason the "embeddings/semantic
   search" direction (kept out of this plan — see below) isn't merely a
   nice-to-have: it's the actual right answer once a project is big
   enough for "5 recent" to stop meaning anything. Recorded honestly, not
   solved here.

Also genuinely unverified, and worth checking against a real large
dataset if one is available during execution (not `test-studio`'s own
handful of documents): whether `count(*[_type == $type])` and `*[_type ==
$type] | order(_updatedAt desc)[0...5]` stay fast on a type with tens of
thousands of documents, or whether either needs its own index/optimization
Sanity's query engine may or may not already provide. No evidence either
way from this session — flagged as a STOP-condition-adjacent check, not
asserted as either fine or broken.

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
- `src/inbox/Inbox.tsx` (`handleFindContentGaps`, plus a new shared cache
  used by it and by the `<AskInbox>` render site)
- `src/inbox/AskInbox.tsx` (`handleSubmit`) — needs the survey passed in
  as a prop from `Inbox.tsx`, the same way `context` already is, since
  `AskInbox` itself has no direct `client`/`schema` access today
- `README.md` (the existing "Optional: finding content gaps" section, and
  wherever `context`/Ask are documented — update to state plainly that
  these two reads now also see an automated survey of the project's own
  content types, not just on-screen rows)

**Out of scope** (recorded below as real follow-ups, not forgotten):
- Wiring the same survey into `handleSummarize`/`handleSuggestTodos` —
  see "Why only Ask, not Summarize/Suggest todos" above. Revisit only
  with a real reported gap in their output quality.
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

- Commits land directly on `main`. Message style: `feat: feed Ask the same
  automated content survey Find content gaps already uses`.
- The file rename (Step 1) is worth its own commit, separate from the
  behavior changes in later steps — a rename-only diff is trivial to
  review on its own; bundling it with real logic changes makes both
  harder to read.
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

### Step 1a: Bounded concurrency, not one sequential fetch at a time

See "At scale" above for why this matters: at `MAX_SURVEYED_TYPES = 30`,
today's sequential loop means up to 60 network round-trips, one after
another, before the survey resolves — real, user-visible latency on a
project with a realistic number of content types, independent of how big
any single type's own document count is.

Replace the sequential `for...of` loop's own per-type work with a small,
bounded-concurrency batch — not `Promise.all` over all 30 at once
(a real burst-rate-limit risk against Sanity's own API, which is exactly
why the original code chose sequential in the first place), a fixed
concurrency pool instead:

```ts
/** Parallel fetches in flight at once — enough to cut wall-clock time meaningfully on a project with many real content types, low enough to stay well clear of a burst against Sanity's own API rate limits. */
const SURVEY_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker))
  return results
}
```

Replace `surveyContentTypes`'s own `for (const {name, title} of types) {
... }` loop (with its two `// eslint-disable-next-line no-await-in-loop`
comments) with `mapWithConcurrency(types, SURVEY_CONCURRENCY, async
({name, title}) => { ... return summary })` — the per-type body (the
`count` fetch, the conditional sample fetch, building one
`ContentTypeSummary`) moves into `fn` unchanged; only the *loop
structure* changes, from fully sequential to a 5-wide pool. Remove the
now-unneeded `no-await-in-loop` disable comments — there's no `await` in
a `for` loop body anymore for that rule to flag.

Do NOT raise `SURVEY_CONCURRENCY` casually to "make it faster" without a
real reason — 5 is a deliberate, conservative starting point against an
API whose actual rate limits this plan has not benchmarked. If this
genuinely needs tuning, that's its own follow-up with real evidence
(an actual observed rate-limit error, or an actual measured latency
budget), not a guess baked in here.

**Verify**: `npm test -- projectDigest` → same existing cases still pass
(the loop restructuring changes *how* the per-type work runs, not what
each type's own summary contains — assert this with the existing tests
unchanged, not new ones). Manually confirm via a quick local timing check
(e.g. `console.time`/`console.timeEnd` around a call to
`surveyContentTypes` against a schema with close to 30 real types, if
`test-studio` or a real large dataset is available) that wall-clock time
drops meaningfully versus the old sequential loop — this is the whole
point of the step, so confirm it actually did something before moving on.

### Step 2: A short-TTL cache shared between the two reads

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

### Step 3: Wire the same survey into `AskInbox`'s `handleSubmit`

A survey failure must not fail the whole read — wrap `getProjectDigest()`
in its own try/catch and fall back to no survey rather than surfacing an
error for what is genuinely optional enrichment:

```ts
let projectDigest = ''
try {
  projectDigest = formatContentGapsDigest(await getProjectDigest())
} catch {
  // Optional enrichment — a failed survey should not fail the whole read.
}
```

`AskInbox` has no direct `client`/`schema` access — pass the already-
formatted digest down as a new, optional prop from `Inbox.tsx` (computed
once via the same `getProjectDigest()` cache, not a second survey
mechanism):

```ts
interface AskInboxProps {
  rows: readonly MergedRow[]
  onSelect: (keys: string[]) => void
  context?: string
  /** The same automated project survey `handleFindContentGaps` uses — see `Inbox.tsx`'s own `getProjectDigest`. Optional: a failed or not-yet-loaded survey just means this question gets asked without it. */
  projectDigest?: string
  result: AskState
  onResultChange: (state: AskState) => void
}
```

In `handleSubmit`, prepend the same labeled block ahead of the existing
`context`/items sections (same shape `handleFindContentGaps` already uses
for its own `context`/survey ordering). In `Inbox.tsx`'s own
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

### Step 4: Tests

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

### Step 5: Update `README.md`

Update whichever sections currently describe Ask and "Optional: finding
content gaps" to state plainly that both reads now ground themselves in
the same automated survey of the project's real content types (counts,
samples, schema descriptions, reference graph), not just on-screen rows
and the integrator's own `context` prose. Keep the existing `context`
explanation as-is — it's still accurate, just no longer the *only*
automated signal for these two reads. Do not change how Summarize/Suggest
todos are documented — their own behavior is unchanged by this plan.

**Verify**: manually re-read the updated section(s) against this plan's
own Step 3 behavior — every claim must trace to real code, not be
aspirational.

### Step 6: Full sweep

**Verify**: `npm run typecheck && npm run lint && npm test && npm run
build` → all exit 0.

## Test plan

- New cases in `projectDigest.test.ts` (Step 4): `findReferencedTypes`
  (4 cases), `description` propagation (2 cases), `formatContentGapsDigest`
  additions (2 cases, including the no-op regression case).
- Existing cases in `projectDigest.test.ts` re-verified unchanged after
  Step 1a's own loop restructuring (same summaries, different fetch
  shape).
- New cases in `Inbox.test.tsx` (Step 4): cache hit within TTL (1 fetch,
  not 2), cache cleared on rejection.
- Verification: `npm test` → all pass, including every new case.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0; every new case from Step 4 exists and passes
- [ ] `npm run build` exits 0
- [ ] `src/inbox/contentGapsDigest.ts`/`.test.ts` no longer exist;
      `src/inbox/projectDigest.ts`/`.test.ts` do, with git history
      preserved (`git log --follow` on the new path shows the old file's
      history)
- [ ] `surveyContentTypes`'s own per-type loop uses bounded concurrency
      (Step 1a), not a fully sequential `for` loop — confirmed via a real
      timing check, not just code review
- [ ] `handleFindContentGaps` and `AskInbox`'s `handleSubmit` both use the
      same shared, TTL-cached survey — not two independent fetches
- [ ] `handleSummarize`/`handleSuggestTodos` are unmodified by this plan
- [ ] A failed survey never fails the whole read for either consumer —
      each degrades to "no project digest this time," same as a missing
      `context` already does
- [ ] `README.md` accurately describes the new automated-survey behavior
      for Ask and Find content gaps only
- [ ] No files outside the "Scope" list are modified (`git status`)
- [ ] `plans/README.md` status row for 042 updated

## STOP conditions

- The 5-minute TTL trade-off (see "The one real trade-off" above) doesn't
  sit right once you've thought it through against this specific
  codebase's own `liveQuery$`-everywhere-else convention (every *other*
  read in this pane is live/reactive, never time-cached) — this is a
  real, deliberate exception to that pattern for a good reason (avoiding
  2x the dataset reads per click), but it's worth flagging rather than
  silently accepting if it reads as inconsistent with the rest of the
  codebase's own stated conventions.
- The "At scale" section's own open question — whether `count()` and
  `order(_updatedAt desc)[0...5]` stay fast on a type with tens of
  thousands of documents — turns out to be a real problem once tested
  against an actual large dataset. If so, this needs its own fix
  (a cheaper count strategy, or dropping the sample query for very large
  types) before this plan's done criteria can be considered met for a big
  project, not just for `test-studio`'s own small one.
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
  projects likely don't either, by default. Not merely a nice-to-have,
  though: see "At scale" above — "5 most recent per type" is a
  progressively worse proxy for "what this project actually contains" the
  bigger a project gets, which is exactly when automation matters most.
  Worth its own future plan once there's a real project (and a real
  index) to test it against, not built speculatively here.
- **`context` accepting a file or URL, not just an inline string** —
  already recorded separately (this session's own
  `project_context_config_external_source_idea` memory); unrelated to the
  automated-survey mechanism this plan builds, since that idea is about
  *how the integrator's own prose gets authored*, not about automating a
  dataset read.

## Maintenance notes

Any future AI read added to this pane that reasons about the whole
project (not just the current open queue) should call
`getProjectDigest()` from the start, the same way it should use the
request-generation-ref guard from Plan 032 — both are now the established
pattern here. A read about the current queue (like Summarize/Suggest
todos) should not reach for it by default — see "Why only Ask, not
Summarize/Suggest todos" above before adding it to a third read. If the
TTL trade-off ever proves wrong in practice (a real report of stale
content-gap suggestions during active editing), the fix is a shorter TTL
or a manual refresh affordance, not reverting to independent fetches per
read. If `SURVEY_CONCURRENCY` (Step 1a) ever needs tuning, do it from a
real observed rate-limit error or measured latency budget, not a guess.
