# sanity-plugin-structure-inbox

Turns the empty Structure canvas into an inbox.

Before an editor clicks anything, the right-hand side of the Structure tool is blank — on the most
visited screen in the Studio. This plugin fills it with the things actually waiting on them:
drafts left unpublished, releases coming up, whatever else you feed it. Each one can be opened, or
ticked off.

> **Requires Sanity Studio v6.**

## Installation

```sh
npm install sanity-plugin-structure-inbox
```

## Usage

Add it to `plugins` in `sanity.config.ts`, **after** `structureTool()`:

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {
  openTasks,
  structureInbox,
  unpublishedDrafts,
  upcomingReleases,
} from 'sanity-plugin-structure-inbox'

export default defineConfig({
  // ...
  plugins: [
    structureTool(),
    structureInbox({
      sources: [openTasks(), unpublishedDrafts({olderThanDays: 7}), upcomingReleases()],
    }),
  ],
})
```

Order matters: the plugin works by extending the structure tool that is already in the array, so a
tool that has not been added yet cannot be found. If it is listed first, you get a console warning
and no Inbox.

Editors now land on the Inbox instead of a blank canvas. Nothing is added to your structure — no
extra menu item — because the plugin teaches the root pane to resolve the Inbox id directly.

## Sources

A source is a feed of inbox items. Eight ship with the plugin:

| Source                                                       | What it lists                                                 | Whose      |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| `openTasks({limit, onlyMine})`                               | Sanity Tasks assigned to you and still open.                  | Yours      |
| `unpublishedDrafts({olderThanDays, limit, types, onlyMine})` | Drafts that have sat untouched long enough to look forgotten. | Everyone's |
| `upcomingReleases({limit})`                                  | Releases that are scheduled or still being filled.            | Everyone's |
| `needsAttention({limit})`                                    | Releases that should have run and didn't, or are quietly stalling. | Everyone's |
| `documentValidation({limit, types})`                         | Drafts currently failing their own schema's validation rules. | Everyone's |
| `assetIssues({limit, maxSizeBytes, altFieldName})`            | Oversized, unused, or missing-alt-text image/file assets.     | Everyone's |
| `unresolvedComments({limit, onlyMine})`                       | Unresolved comment threads (requires the Growth plan or above). | Yours    |
| `todos({title, placement})`                                  | A personal scratch list you type into, right in the pane.     | Yours      |

Sources choose their column with `placement`. `main` is the wide column on the
left, for work to get through — every `main` source's items are merged into
**one sorted list**, tagged by source on each row, rather than one box per
source. `aside` is the narrow column on the right, for context worth seeing
but not acting on: each `aside` source keeps its own small card, and the whole
column disappears when every `aside` source is currently empty — ambient
context earns no space when there's nothing in it. `upcomingReleases` defaults
to `aside`, and only the main column counts toward the headline — "three
releases are scheduled" is not three things asking for your attention.

The same column also holds a persistent Overview card — oldest open item,
when the next snoozed item wakes, how many items are overdue, open items by
assignee — but only once the open list is long enough that a breakdown of
it says something the list itself cannot; below around a dozen open items
it's a mirror, not a summary, so it stays out of the way (except when
something is about to wake, which is worth saying regardless of list size).

Main-column rows are sorted the way an editor actually triages an inbox, not
by which source they came from: the most urgent `tone` first, then the
longest-waiting `timestamp` first within a tone. Two rows tied on both keep
the order their sources were configured in.

### Whose items are these

Every section says whether its items are yours or the whole team's, because
what a tick means differs either side of that line. A source declares it
with `audience`.

- **`openTasks` is personal.** A task is assigned to someone, so `onlyMine`
  defaults to `true`.
- **`unpublishedDrafts` is shared.** A draft left unpublished is usually the
  team's problem rather than one person's, and anyone can pick it up, so
  `onlyMine` defaults to `false`.

- **`todos` is always yours.** There is no "everyone's" reading of a todo you
  typed for yourself, so `audience` is not configurable.

Set `onlyMine: true` on drafts to narrow the list to your own unfinished work.
It costs one extra request per refresh: authorship is not on the document, and
there is no dataset-wide "documents I edited" query — it lives in the
transaction log, whose dataset-wide form returns nothing without document ids.
What that endpoint does support is a batch of ids plus an `authors` filter, so
GROQ narrows to a page first and one request then asks "of these ten, which are
mine". Nothing ever scans the dataset.

### Tasks

`openTasks` reads Sanity Tasks from the Studio's addon dataset — the same one
comments use — rather than from your content dataset. A Studio that has never
used tasks has no addon dataset at all, which shows up as an empty section
rather than an error.

A task also carries its own real, closed-or-not status — the one source in
this plugin where "cleared" can mean something Sanity itself confirms rather
than just "this editor stopped seeing it." `openTasks` widens its own query to
also fetch tasks closed within the last `clearedWithinDays` (default `7`), so
closing a task elsewhere still shows up in this editor's Cleared tab for a
while, the same way it would in Sanity's own Tasks panel. `limit` applies to
open and recently-closed tasks separately, not to the two combined — a
Studio with `limit` or more open tasks would otherwise silently push a
just-closed task off the end of the list before it ever reached Cleared.

Both `useAddonDataset` and the `tasks.task` document shape are marked beta in
Sanity's own typings. `useAddonDataset` is reached only through a lookup that
tolerates it going away, never a static import, so if Sanity removes it that
source's card shows an error instead of the whole Studio failing to boot. The
`upcomingReleases` source treats `useActiveReleases`, which is `@internal`,
the same way.

### Needs attention

`upcomingReleases` is deliberately calm — a release running to plan is
context, not something to act on, which is why it lives in the aside column.
`needsAttention` is the other half of the same data: a release that is
**off track**, promoted into the main column because nothing else in the
Studio will ever say so on its own. Three conditions, each its own tone:

- **Overdue** (critical) — a scheduled release's intended publish time has
  passed and it still hasn't run. Scheduling a release does not guarantee it
  actually publishes itself: the automation can fail, and when it does, the
  release just sits there, unpublished, with nothing else flagging it.
- **Empty and imminent** (caution) — scheduled within a few days and still
  has no documents in it. Still fixable, which is why it's a nudge rather
  than an alarm. A document count this plugin can't determine (rather than
  one confirmed at zero) never counts as empty — an unknown is not evidence.
- **Ageing and undated** (no tone) — no scheduled time at all, and still
  being filled weeks after it was created. A slow leak, not a fire.

Deliberately a separate source from `upcomingReleases`, not a mode on it: a
source has exactly one `placement`, so a Studio can take the nag without the
ambient card, or the card without the nag. It also has no `resolve` —
running a release is a deliberate act with its own confirmation and belongs
in the Releases tool, same reasoning `upcomingReleases` already uses — so a
tick here only ever acknowledges, never touches the release itself. No AI:
every condition is a date comparison and a document count, both already
fully certain.

An off-track release can appear in **both** columns at once — the aside
card (it's still a release) and the main list (it's also an obligation).
That's correct, not duplication: the two columns answer different
questions. `assign` is shared between them for the same reason: both rows
can name the same release (its own `_id`), so assigning it from either
column is one fact, not two — see [Assigning an item to someone
else](#assigning-an-item-to-someone-else).

### Document validation

Every Sanity schema defines `validation` rules, and nothing in Sanity's own
Structure Tool — or, until now, this plugin — showed which documents
currently fail them, in aggregate. `documentValidation` runs
[`validateDocument`](https://www.npmjs.com/package/@sanity/validation) (the
same engine Sanity's own `sanity documents validate` CLI command calls in
bulk) against your unpublished drafts, and lists the ones currently failing,
with which field and why.

Deliberately scoped to **drafts only**: a draft is work someone is actively
doing right now, the same reasoning `unpublishedDrafts` already uses.
Published documents can fail validation too — that's a wider net this
source doesn't cast yet.

Reference-existence checks (a `Rule.custom` that looks up another document,
say) are pre-batched into one request rather than checked one reference at a
time — the same thing Sanity's own CLI does, for the same reason: a
document with several references shouldn't turn one validation pass into a
dozen round trips. Only `'error'`-level markers become a row; a `'warning'`
does not, the same "colour sparingly" reasoning `InboxItem.tone` already
follows elsewhere in this plugin.

No `resolve`: a validation error is fixed by editing the document, not by
this pane. No AI: a schema's own rules are already fully deterministic.
Offers `assign` — see [Assigning an item to someone
else](#assigning-an-item-to-someone-else) — sharing the same assignment
record `unpublishedDrafts` does for the identical document, since a row
here is that same draft, just filtered to ones currently failing
validation.

### Asset issues

Neither Sanity's own Structure Tool nor its Media library surfaces asset
problems in aggregate. `assetIssues` runs three independent checks against
your image/file assets:

- **Oversized** — larger than `maxSizeBytes` (default 5 MiB).
- **Unused** — referenced by nothing, using Sanity's own documented recipe
  (`count(*[references(^._id)]) == 0`). Skipped entirely (reports zero rows,
  rather than risk a slow query) once the project has more than 200 total
  assets — the same silently-absent-when-uncertain posture `needsAttention`
  already uses elsewhere in this plugin.
- **Missing alt text** — a top-level image field, on any document type, that
  declares its own `altFieldName` sub-field (default `'alt'`, the common
  convention — a project using a different name for its own alt-text field
  should pass it explicitly) but leaves it empty on a real document. This one
  is scoped to top-level image fields, not any nested inside an object or array.

Oversized and unused rows have no click-through: `sanity.imageAsset`/
`sanity.fileAsset` are real document types, but Structure Tool deliberately
excludes them from its own default document handling, so there's no safe
"open" target for one outside the Media browser. A missing-alt-text row is
on an ordinary document, though, and opens it the normal way.

No `resolve`: fixing any of these means editing the asset or the document
that references it. No AI: all three are plain, deterministic facts.
Offers `assign` for all three kinds — an asset has no single natural owner,
but "who's fixing this" is still a real, delegable task.

### Unresolved comments

**Requires the [Growth plan](https://www.sanity.io/pricing) or above** —
Sanity's own Comments feature isn't available on the Free plan. On a
project without it, `unresolvedComments` simply contributes nothing (the
same graceful "nothing to show" every other source in this plugin falls
back to when its own data isn't there yet), so it's safe to configure on
any project regardless of plan.

`unresolvedComments` lists unresolved comment threads (top-level only, not
replies) — by default, only ones that @mention you, mirroring `openTasks`'s
own `onlyMine` default; set `onlyMine: false` for every open thread
team-wide. Comments live in the same per-project add-on dataset Sanity
Tasks already uses, so this reads it the exact same way `openTasks` does —
there's no separate API, config, or organization-level setup to wire up.

No `resolve`: resolving a thread is a Studio comment-panel action this pane
doesn't reimplement — clicking a row opens the document, where the comment
itself is still visible and resolvable as normal. No AI: a comment already
says what it means. Offers `assign`, with the thread's own `@mention`
suggested (never locked) when exactly one person is mentioned — see
[Assigning an item to someone else](#assigning-an-item-to-someone-else).

### Todos

`todos` is the one built-in source with no external system behind it: the
items *are* the plugin's own store. It has no `resolve` — there is nowhere
else for a todo to complete — so ticking one off only removes it from your
inbox, the same as any other source without `resolve`.

A **+ Add todo** button sits above the list; clicking it opens a dialog for a
title, an optional description, and an optional due date, rather than an
inline input left open at all times. A due date sorts and colours the row the
same way `openTasks` treats one — `timestamp` prefers it over the creation
time, and the row goes critical once it's past.

A source opts into that dialog by returning `create` from `useItems`:

```ts
useItems() {
  return {
    items,
    create: ({title, description, dueBy}) => addMyOwnItem(title, description, dueBy),
  }
}
```

`todos` also returns `remove`, so a finished one can be deleted for good —
select it and **Delete** appears next to (or instead of) **Ask AI**. This
matters because `todos` has no `resolve`: ticking one off only **acknowledges**
it (see "Selecting and acting" below) — a marker that the editor has seen it,
which never moves it out of Open. Without `remove`, a todo an editor is
actually finished with would sit in Open, acknowledged, forever. `remove` is
what a source without `resolve` uses to let an editor clear an item out for
real:

```ts
useItems() {
  return {items, remove: (item) => deleteMyOwnItem(item.id)}
}
```

#### Handing your todos to someone else

`todos` also offers `transfer`, not `assign` — select rows, then pick a name
from the **Hand off to…** picker, and they move out of your own list and
into theirs. Real scenario this exists for: leaving the team (parental leave,
changing roles) and wanting to hand off your own open todos before you go,
rather than leaving them to just sit there or get deleted.

This is a different verb from `assign` on purpose: every other assignable
source labels a shared document everyone already reads (see "Assigning an
item to someone else" above) — a todo has no shared document, only the
acting editor's own private list, so there is nothing for a label to attach
to. `transfer` moves the item's actual home instead: it reads the
recipient's own todos document, inserts the item there (keeping its
original id, so it survives the same conflict-resolution `mergeTodos`
already gives any other edit), writes that first, and only then removes it
from the sender's list — so a failed write never loses the todo outright.

A source opts in the same shape `assign` uses:

```ts
useItems() {
  return {
    items,
    transfer: {
      users: assignableUsers,
      toUser: (item, userId) => handOffMyOwnItem(item.id, userId),
    },
  }
}
```

### Live updates

`openTasks` and `unpublishedDrafts` re-run their query whenever a matching
document changes — a task someone else closes, a draft someone else
publishes, leaves or enters the list without the editor navigating away and
back. Built on `client.listen`, the query-scoped realtime listener — not the
newer Live Content API, which invalidates by sync tag across a whole dataset
and is built for cached, published content rather than an arbitrary GROQ
filter. `upcomingReleases` was already live; it reads Sanity's own release
store, which keeps itself in sync.

Writing your own source that should update itself the same way: see
`liveQuery$` in `src/inbox/sources/liveQuery.ts` — it wraps a one-shot
`client.observable.fetch` in exactly this listen-then-refetch shape.

### Reading the open count without the pane

`useInboxOpenCount()` returns the same live "how many things are open"
number the pane's own headline shows — usable anywhere in the Studio, not
only while the Inbox pane itself is mounted (a custom navbar badge, say).
Returns `null` until it has reported at least once.

```tsx
import {useInboxOpenCount} from 'sanity-plugin-structure-inbox'

function MyBadge() {
  const count = useInboxOpenCount()
  return count ? <Badge>{count}</Badge> : null
}
```

A source contributes to this count only if it defines `useOpenCount`
(alongside its own `useItems`) — see "Writing your own" below for what that
is and when a source needs it.

### Asking AI about an item

`unpublishedDrafts` also offers `assess`: click **Ask AI** on a row and Sanity's
Agent Actions gives a one-line read — "looks ready to publish", "still missing
a hero image". Informational only; it never writes to the document, so it
renders the same in every view (Open, Snoozed, Cleared).

A source opts in by returning `assess` from `useItems`:

```ts
useItems() {
  return {
    items,
    assess: (item) =>
      client.agent.action.prompt({
        instruction: 'Given the following document:\n$document\n---\nYour question here.',
        instructionParams: {document: {type: 'document', documentId: item.id}},
      }),
  }
}
```

### Assigning an item to someone else

Most built-in sources offer `assign`: select rows, then pick a name from the
**Assign to…** picker. This is delegation, not ownership — a row needs no
single natural owner to be worth assigning (an upcoming release, a stray
oversized asset), the same way a task board assigns work regardless of
whether the underlying thing has one. `unpublishedDrafts`, `documentValidation`,
`linkCheckerFindings`, `unresolvedComments`, `upcomingReleases`, `needsAttention`,
and `assetIssues` all offer it. Two built-in sources don't, both for a real
structural reason: `openTasks` already has a native, real assignee field of
its own (shown, but read-only, so there's no second competing path to the
same fact), and `todos` lives in the acting editor's own private list with
no shared copy anywhere to label — see [Handing your todos to someone
else](#handing-your-todos-to-someone-else) for the different verb that
fits that case instead.

This is **not** a Sanity Task: an earlier version created a real `tasks.task`
document per assignment, which surfaced as a second, separately-titled
"Follow up: …" row editors had to reconcile with the actual thing it was
about, needed the addon dataset for a feature that has nothing to do with
Sanity's own Tasks concept, and had a real bug — reassigning something that
already had one of these tasks did not reliably find and reuse it, so a
fresh task was created on every click. Assignment is now one plain,
unregistered document type (`structureInbox.assignment`), shared by every
assignable source, mapping a target id to an assignee id — the same shape
and reasoning `useDismissals.ts` already uses for its own per-user preference
doc. One shared type rather than one per source: real Sanity ids never
collide across a draft, a release, an asset, and a comment, and it means
"everything assigned to me" is one query away, not several unioned together,
if a future view ever wants that.

Who can be assigned comes from `useUserListWithPermissions` — `@beta` in
Sanity's own typings, reached through `optionalHook` for that reason —
filtered to whoever can update documents in this dataset.

**Assign to…** only appears when every currently selected row comes from the
same source: assigning across sources with different assignee pools has no
single well-defined meaning, so the picker simply doesn't offer it for a mixed
selection.

With exactly one row selected, a source can also offer a suggestion above the
picker — always dropped, never offered, if the candidate turns out not to be
assignable, and never pre-selected: the editor still has to click it, the
same as choosing a name directly. Two built-in sources do this today, each
from its own real fact, never a guess:

- `unpublishedDrafts` suggests whoever most recently edited the draft, read
  from the transaction log via `fetchDocumentAuthors` (no LLM — this is
  already in the data).
- `unresolvedComments` suggests whoever the thread's own `@mention` named,
  when exactly one distinct user is mentioned — resolving a thread is still
  delegable to whoever's actually doing it, so this is a suggestion, not a
  lock.

A source opts in by returning `suggestAssignee` from its `assign` bag:

```ts
assign: {
  users,
  toUser,
  suggestAssignee: async (item) => {
    const authors = await fetchDocumentAuthors(client, [item.id])
    const mostRecentAuthor = authors.get(item.id)?.[0]
    if (!mostRecentAuthor || !isAssignable(mostRecentAuthor)) return null
    return {userId: mostRecentAuthor, reason: 'lastEditor'}
  },
}
```

### Writing your own

`useItems` is a React hook, so a source can reach for `useClient`,
`useCurrentUser`, or any Studio hook it needs. Each source still runs in its
own component under the hood — its hooks get a stable call order and its own
error boundary, so one bad query costs only that source's rows, surfaced as a
small inline notice in the merged list, never the whole Inbox. What changed is
that a `main` source no longer draws its own card: it hands its items to the
one list that draws all of them together.

```tsx
import {type InboxSource} from 'sanity-plugin-structure-inbox'

export function needsReview(): InboxSource {
  return {
    name: 'needsReview',
    title: 'Waiting for review',
    placement: 'main',
    useItems() {
      const client = useClient({apiVersion: '2025-02-19'})
      // ...fetch, then:
      return {
        items: rows.map((row) => ({
          id: row._id,
          title: row.title,
          subtitle: 'Submitted for review',
          timestamp: row._updatedAt,
          intent: {type: 'edit', params: {id: row._id, type: row._type}},
        })),
      }
    },
  }
}
```

A source can also offer `useOpenCount(snoozes, now)` — a
cheaper alternative to `useItems()` that only reports a live open count,
read by `useInboxOpenCount()` (see above). It matters because that count
is computed from *outside* the Inbox pane, at a point in
the Studio's component tree where some hooks a source's own `useItems()`
might depend on (Sanity's addon dataset, for one) aren't guaranteed to be
available — a source that omits `useOpenCount` simply doesn't contribute to
that external count, rather than risk `useItems()` failing somewhere it
was never designed to run.

## Selecting and acting

### Open, Cleared, Snoozed, and what "Acknowledge" means

This plugin's two guiding rules: **Sanity is the source of truth**, and
**editors need to know what they can, and should, work on**. Together they
mean a tick can't always claim the same thing.

- **Open** — everything not yet resolved and not currently snoozed. An item
  stays here even after someone acknowledges it; acknowledging is not a way
  out of Open.
- **Cleared** — only items a source itself confirms are actually resolved,
  with real evidence (a task's own closed status, say). Never populated by an
  editor ticking something — there is no "my own cleared," only "Sanity's."
  A source with no `resolve` (a draft, a release, a todo) can never put
  anything here, because this plugin has no way to verify anything changed.
- **Snoozed** — hidden from Open until a chosen time, or until the item
  changes underneath the snooze, whichever comes first.
- **Acknowledge** — a personal, non-binding "I've seen this" marker, available
  wherever a tick can't mean a real resolution. It shows as a small checkmark
  on the row and changes nothing in Sanity — the item is still open, for this
  editor and everyone else, and stays in Open until it's actually resolved or
  removed. Snoozing an item acknowledges it too, for the same reason: coming
  back from a snooze shouldn't look freshly-unseen.

This is why `openTasks` alone can put something in Cleared: a task has a real
status. Everything else in this pane can only be acknowledged or, for `todos`
(which has nowhere else to record completion), removed outright.

Ticking a checkbox **selects** a row; it does not complete it. Once something is
selected, the action bar appears and the editor chooses — the order a mail
client uses, and the reason a tick that silently acted felt wrong.

Selection spans the whole merged list, not one source at a time: tick a task
and a draft together, and the selection bar resolves what it can for real and
acknowledges the rest in the same click — one Promise per resolvable row, so
one failing never strands the rest (see `Promise.allSettled` in
`MergedList`). **Ask AI** and **Delete** only show on a row once it's
selected — both are per-row decisions, not a permanent line under every row.

The confirm button reads differently depending on what's selected, because
ticking means one of two genuinely different things:

- A source that returns **`resolve`** from `useItems` completes the item where
  it actually lives, then takes it out of the editor's inbox — **Mark as
  done**. `openTasks` closes the task for everyone, and (within
  `clearedWithinDays`) it shows up in Cleared for anyone who had it, not just
  whoever ticked it.
- A source without `resolve` (`unpublishedDrafts`, `upcomingReleases`, `todos`)
  has nothing this pane can verify, so ticking only **Acknowledges** it: a
  checkmark appears on the row, and it stays in Open — publishing a draft or
  running a release has validation, permissions and side effects this pane has
  no business performing, so there is no "done" this plugin can claim on their
  behalf. An acknowledged item that's never actually resolved sits in Open,
  marked seen, indefinitely — see `todos`' own `remove` above for the one way
  around that.
- A mixed selection does both at once, and the button's tooltip says so.

**Open**, **Snoozed** and **Cleared** are tabs. Cleared only ever holds items a
source itself confirms are resolved — never an acknowledgment — so today it's
only ever populated by `openTasks` (see "Tasks" above); a source with no
`resolve` never has anything to show there. In the Cleared tab the same
control reads **Mark as not done**, undoing the source's own resolution where
that's meaningful.

Selecting rows in the Open tab also offers **Snooze**, a picker with three
presets — *later today*, *tomorrow*, *next week*. A snoozed item leaves Open
for the Snoozed tab, where **Wake now** brings it back early — acknowledged in
the process, the same as ticking it directly, so it doesn't read as
freshly-unseen the moment it's back. Left alone, it wakes on its own once the
chosen time passes — no source involvement, and nothing changes anywhere
outside this editor's own inbox.

A snooze also **wakes early when the item changes** — the same rule an
acknowledgment follows, and for the same reason: a snooze says "not now, I've
seen this version", not "hide it no matter what happens to it".

`unpublishedDrafts` also offers `suggestSnooze`: with exactly one row
selected, Sanity's Agent Actions reads the document for anything with a real
date — an event, a launch, a deadline — and if it finds one, a second small
button appears next to the plain Snooze icon, showing that date, with the
reason as its tooltip. It is only ever a suggestion: nothing is snoozed until
the editor clicks it, the same click a preset would need. No date-related
content means no button, rather than a guessed one.

A source opts in by returning `suggestSnooze` from `useItems`:

```ts
useItems() {
  return {
    items,
    suggestSnooze: (item) =>
      client.agent.action.prompt({
        instruction:
          'Given the following document:\n$document\n---\n' +
          'When would an editor next want to look at it? Answer with ' +
          '{"until": "<ISO 8601 instant>", "reason": "<a few words>"}, ' +
          'or {"until": null} if nothing in it implies a date.',
        instructionParams: {document: {type: 'document', documentId: item.id}},
      }),
  }
}
```

Return `resolve` to make a tick mean something real:

```ts
useItems() {
  const client = useClient({apiVersion: '2025-02-19'})
  return {
    items,
    resolve: async (item) => {
      await client.patch(item.id).set({reviewed: true}).commit()
    },
  }
}
```

### Where an acknowledgment is stored

In a document scoped to the editor: `_id` is derived from their user id, and the
type is deliberately never registered in your schema, so it stays out of the
structure tool, search and reference pickers. The code name is still
`dismissals` — `useDismissals`, `dismiss()`, `restore()` — a holdover from
before this plugin could tell a real resolution apart from an editor just
having seen something; what it records today is exactly that: acknowledgment,
never Cleared.

Sanity's own `/users/me/keyvalue` store would be the natural home — it is where
the Structure tool keeps its pane settings — but it accepts only an allowlist of
Sanity's own keys and rejects anything a plugin writes.

An acknowledgment also **expires when the item changes**. An item's
`changedAt` — its real modification time, separate from the `timestamp` shown
in the row — doubles as a freshness check, so a draft edited after you ticked
it comes back to Open, unacknowledged. Ticking says "I have seen this
version", not "never show me this document again". Omit `changedAt` for
anything whose changes your source cannot observe, and never set it to a
future value (a due date, a publish date) — a future `changedAt` would look
"changed" the instant it is ticked and undo the acknowledgment immediately.

Snoozes and todos each live in a sibling document of their own — same
per-editor, unregistered-type approach, kept apart because neither shares a
lifecycle with an acknowledgment: a snooze expires on its own, and a todo has
nowhere else to live at all — which is also why an acknowledged todo, alone
among built-in sources, never ages back out of Open the way every other
source's acknowledgments do after 90 days; nothing but `remove` ever takes a
todo out of Open for good.

### Recipe: a digest outside the Studio

Nothing this pane shows is private to it — `structureInbox.dismissals.<userId>`,
`structureInbox.snoozes.<userId>` and `structureInbox.todos.<userId>` are
plain, queryable documents in your dataset. That makes a scheduled digest (a
daily "here's what's still open" email or Slack message) a job for a
[Sanity Function](https://www.sanity.io/docs/content-lake/webhooks) — a
separate deployable in your Studio project, not something this npm package
ships or can install for you.

Sketch of what such a Function does, run on a schedule rather than a document
event — fetch stays your own code, but working out what's still open is one
call to `buildDigest`, exported from `sanity-plugin-structure-inbox` for
exactly this, pure and dependency-free, no Studio context required. It reads
each editor's snoozes only, never their acknowledgments — an item someone
merely acknowledged is still open for digest purposes, same as it is in their
own Open tab:

```ts
import {buildDigest, parseSnoozes} from 'sanity-plugin-structure-inbox'

const editors = await fetchEditorsWithParsedState(client) // your own fetch + parseSnoozes per editor
const sources = await fetchConfiguredSourceItems(client)  // your own fetch, shaped as {name, items}[]

const digests = buildDigest(sources, editors)
// digests: {userId, open: InboxItem[]}[] — send however you'd like; the Function is plain Node.js, so any email or chat API works.
```

This intentionally stays a recipe rather than shipped code: a digest's cadence, channel and formatting are product decisions for your Studio, not this plugin's to make.

### Recipe: cleaning up after a departed editor

`structureInbox.dismissals.<userId>`, `.snoozes.<userId>` and
`.todos.<userId>` persist forever once created — nothing in this plugin ever
deletes one, even for an editor no longer on the project. Over a project's
life this adds up to real, if small, unbounded storage growth with no
built-in way to find or reclaim it.

`findStaleEditorDocuments`, exported for exactly this, is the diff — you
supply both lists, it tells you which documents are now orphaned:

```ts
import {EDITOR_DOC_TYPES, findStaleEditorDocuments} from 'sanity-plugin-structure-inbox'

const docs = await client.fetch(`*[_type in $types]{_id, _type}`, {types: EDITOR_DOC_TYPES})
const activeUserIds = await fetchCurrentProjectMemberIds() // your own fetch, e.g. Sanity's project members API

const staleIds = findStaleEditorDocuments(docs, activeUserIds)
// staleIds: string[] — delete however and whenever you like, e.g.:
// await client.delete({query: '*[_id in $ids]', params: {ids: staleIds}})
```

Run this whenever suits your project — a one-off cleanup, or a scheduled
Sanity Function alongside the digest recipe above. This stays a recipe, not
automated behavior, deliberately: this plugin has no independent way to
verify your project's current membership, so it should never delete a
document on your behalf without you supplying and reviewing that list
yourself.

## Options

| Option              | Type            | Default           |                                                                                   |
| ------------------- | --------------- | ----------------- | --------------------------------------------------------------------------------- |
| `sources`           | `InboxSource[]` | `[]`              | The feeds that fill the inbox, in order.                                          |
| `title`             | `string`        | localized `Inbox` | Title for the pane, and for its list item when shown.                             |
| `toolName`          | `string`        | `'structure'`     | Which structure tool to attach to. Set this when the Studio runs more than one.   |
| `showInList`        | `boolean`       | `false`           | Whether to show an "Inbox" entry at the top of the root list.                     |
| `redirectOnLanding` | `boolean`       | `true`            | Whether to open the Inbox when an editor lands on the tool with nothing selected. |

## Getting back to the Inbox

Editors land on it, and clicking the tool in the navbar returns them to it, so most Studios need
nothing else.

If you want a visible entry too, `showInList: true` puts one at the top of the root list. To place
it somewhere specific instead, use `inboxListItem`:

```ts
import {inboxListItem} from 'sanity-plugin-structure-inbox'

structureTool({
  structure: (S) =>
    S.list()
      .title('Content')
      .items([...S.documentTypeListItems(), S.divider(), inboxListItem(S)]),
})
```

## Grounding AI reads in your project

```ts
structureInbox({
  context: 'A design agency site — services, case studies, and a blog.',
  sources: [
    /* ... */
  ],
})
```

Every AI read this pane offers (Summarize, Suggest todos, Ask, Find
content gaps) already reasons about what's in front of it right now — the
open rows, or a content survey — but none of them know what the project
actually *is*. `context` is optional prose describing your own project's
business or positioning, prepended to every one of those reads. Without
it, each still works, just with a weaker, more generic signal (Find
content gaps in particular falls back to inferring context purely from a
sample of existing document text).

Deliberately not threaded into any per-item read (a row's own **Ask AI**,
or **Fix with AI**) — those already ground themselves in one concrete
document, where "what business is this" adds far less than it does for a
judgment call across the whole project.

## Optional: broken links via `sanity-plugin-link-checker`

[`sanity-plugin-link-checker`](https://www.sanity.io/plugins/sanity-plugin-link-checker)
scans your dataset for dangling references and dead external links and keeps
its findings in one report document. `linkCheckerFindings()` reads that
report as an Inbox source — a broken reference or dead link shows up
alongside your tasks and drafts instead of only in that plugin's own tool.

It's a **separate entry point**, not part of this package's main export,
because `sanity-plugin-link-checker` is a whole other, independently
versioned plugin — pulling it into the main barrel would make it a hard
dependency of every Studio using this package, even one that has never
heard of link checking. `sanity-plugin-link-checker` is listed as an
optional peer dependency; only a Studio that imports from this entry point
needs it installed:

```ts
import {structureInbox} from 'sanity-plugin-structure-inbox'
import {linkCheckerFindings} from 'sanity-plugin-structure-inbox/link-checker'

export default defineConfig({
  plugins: [
    structureTool(),
    structureInbox({
      sources: [
        // ...your other sources
        linkCheckerFindings(),
      ],
    }),
  ],
})
```

`linkChecker()` — `sanity-plugin-link-checker`'s own Studio tool — is
**not required** here and deliberately left out of that example:
`linkCheckerFindings()` reads and runs scans directly from that plugin's
headless `core` (`readReport`/`runScan`/`writeReport`), the same engine its
own "Run scan" button and CLI call, and needs no Studio tool mounted to do
either. Only its npm package is a dependency of this integration, not its
separate tool tab. Add `linkChecker()` to `plugins` yourself only if you
also want that plugin's own standalone panel or CLI, alongside the Inbox.

No `resolve`: confirming a link is actually fixed means re-running that
plugin's own scan, which is its job, not this pane's — ticking an item here
only acknowledges it (see above), the same as any other source with nothing
this plugin can independently verify. For the same reason it never appears
in Cleared: unlike a task's own `status`, there's no persisted "confirmed
fixed" flag to read — a fixed finding just stops appearing in the next
scan, the same way a published draft's document just stops existing.

By default only confirmed-`broken` links and dangling references show up —
not `unverifiable` ones. Per `sanity-plugin-link-checker`'s own README, a
browser-only check "mostly come[s] back unverifiable rather than a real
answer" without its Document Function deployed; including those by default
would flood the inbox with noise nobody's confirmed is actually broken.
Pass `includeUnverifiable: true` once that Function is deployed, or if the
noise is acceptable for your project.

## Optional: finding content gaps

```ts
structureInbox({
  contentGaps: {},
  context: 'A design agency site — services, case studies, and a blog.',
  sources: [
    /* ... */
  ],
})
```

With `contentGaps` configured, a **Find content gaps** button appears next
to Summarize. It surveys every real document type in your schema — how many
documents each has, plus a small sample of real text from each — and asks
AI what looks missing given what's actually there: an under-supported claim,
a content type with far fewer entries than a related one, a topic mentioned
in passing but with nothing dedicated to it. Results show as a dismissible
card, same as Summarize's own read.

`context` (see [Grounding AI reads in your project](#grounding-ai-reads-in-your-project)
above) matters most here of every read in this pane — without it, this
falls back to inferring context purely from the content sample itself, a
weaker signal since a schema's field names alone never reveal what a
project actually promotes.

**Unlike every other source or read in this pane, this one is a judgment
call, not a fact.** A broken reference or a failed validation rule is
objectively true; "you're missing case studies" is AI's opinion, sometimes
right, sometimes not. It's also the heaviest read here — every document
type, not 20-30 rows — which is why it's off by default rather than a
default cost every Studio pays.

This is deliberately a read-only insight, v1: there's no "apply" or "draft
this for me" yet. Suggesting *how* to close a gap, and drafting real
content, is real, consequential work this pane doesn't take on today.

## How it works

Worth knowing, because it explains the one limitation below.

At `/structure`, the Structure tool resolves exactly one pane — the root list. The root's `child`
resolver is never called, so there is no "default child" to render into the empty canvas. What
there is, is a URL. The plugin registers a `studio.components.activeToolLayout` override, which
Sanity renders inside the active tool's own router scope, and from there navigates to the Inbox
pane's id. The canvas then fills through the ordinary pane-resolution path, and the redirect
`replace`s the history entry so Back still leaves the Studio cleanly.

Making that id resolve is the other half. Pane resolution reaches a child purely by id — a list
item is only the ordinary way an editor produces one — so the plugin wraps the root node and adds
a single branch to its child resolver: the Inbox id resolves to the Inbox pane, and every other id
goes to whatever resolved it before. That is why no menu item is needed, and why the root can be a
list, a document list, or anything else.

It stands aside whenever it should: on a deep link, while an intent is still resolving, and in
tools it is not attached to.

**Limitation:** a structure resolver that returns an _observable_ cannot be extended this way. That
is rare — returning a node, a builder, or a promise all work — but if you do, the plugin warns and
disables the redirect rather than sending editors to a URL that resolves to nothing.

## Localization

Strings live under the `structureInbox` i18n namespace. Override any of them by registering a bundle
with that namespace in your own `sanity.config.ts`:

```ts
import {defineLocaleResourceBundle} from 'sanity'

i18n: {
  bundles: [
    defineLocaleResourceBundle({
      locale: 'sv-SE',
      namespace: 'structureInbox',
      resources: {'inbox.title': 'Start'},
    }),
  ],
}
```

## Develop & test

The repo ships a test Studio as an npm workspace.

```sh
npm install
cp test-studio/.env.example test-studio/.env   # then fill in a project id
npm run build                                  # required — see below
npm run dev                                    # http://localhost:3333
```

The test Studio consumes the plugin's `dist/`, not `src/`, so **a source change is invisible until
you rebuild**. For a tighter loop, run `npm run link-watch` in one terminal and `npm run dev` in
another.

It ships three workspaces, one per behaviour worth checking by hand:

| Workspace | Path       | What it covers                                                                                        |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `default` | `/default` | The happy path, plus a second plugin overriding `activeToolLayout` to prove the chain still composes. |
| `noList`  | `/no-list` | A structure whose root is a document list rather than a list — the Inbox still resolves.              |
| `multi`   | `/multi`   | Two structure tools with the Inbox attached to only one of them.                                      |

Other scripts: `npm test`, `npm run lint`, `npm run format`, `npm run typecheck`.

## License

MIT © Henrik Larsson
