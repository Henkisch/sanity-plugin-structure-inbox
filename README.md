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

A source is a feed of inbox items. Four ship with the plugin:

| Source                                                       | What it lists                                                 | Whose      |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| `openTasks({limit, onlyMine})`                               | Sanity Tasks assigned to you and still open.                  | Yours      |
| `unpublishedDrafts({olderThanDays, limit, types, onlyMine})` | Drafts that have sat untouched long enough to look forgotten. | Everyone's |
| `upcomingReleases({limit})`                                  | Releases that are scheduled or still being filled.            | Everyone's |
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

Main-column rows are sorted the way an editor actually triages an inbox, not
by which source they came from: the most urgent `tone` first, then the
longest-waiting `timestamp` first within a tone. Two rows tied on both keep
the order their sources were configured in.

### Whose items are these

Every section says whether its items are yours or the whole team's, because
"done" means different things either side of that line. A source declares it
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

Both `useAddonDataset` and the `tasks.task` document shape are marked beta in
Sanity's own typings. `useAddonDataset` is reached only through a lookup that
tolerates it going away, never a static import, so if Sanity removes it that
source's card shows an error instead of the whole Studio failing to boot. The
`upcomingReleases` source treats `useActiveReleases`, which is `@internal`,
the same way.

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
matters because a todo's "done" state otherwise lives entirely in the same
90-day-aging dismissal record every other source uses (see below): with
nothing else tracking completion, a todo finished more than 90 days ago would
otherwise reopen, and the list would only ever grow. `remove` is what a
source without `resolve` uses to let an editor clear an item out for real,
not just dismiss it:

```ts
useItems() {
  return {items, remove: (item) => deleteMyOwnItem(item.id)}
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

### Asking AI about an item

`unpublishedDrafts` also offers `assess`: click **Ask AI** on a row and Sanity's
Agent Actions gives a one-line read — "looks ready to publish", "still missing
a hero image". Informational only; it never writes to the document, so it
renders the same in every view (Open, Snoozed, Done).

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

`unpublishedDrafts` also offers `assign`: select rows, then pick a name from
the **Assign to…** picker. This creates a real Sanity Task — the same
`tasks.task` document `openTasks` reads — with `assignedTo` set to the person
chosen, so it shows up in their own `openTasks` list.

The task also sets `target`, so it shows Sanity's own "linked to this
document" affordance in its native Tasks UI — a `_weak` `crossDatasetReference`
to the draft's canonical (published-style) id, plus `documentType`, the exact
shape Sanity's own "Create new task" writes. Confirmed by creating one by
hand — on a draft that has never been published — and reading it back:
Sanity points `target` at that canonical id regardless, which is exactly
what `_weak` is for, so this plugin does the same. `tasks.task` remains
`@beta` in Sanity's own typings regardless.

Who can be assigned comes from `useUserListWithPermissions` — also `@beta` —
filtered to whoever can update documents in this dataset.

**Assign to…** only appears when every currently selected row comes from the
same source: assigning across sources with different assignee pools has no
single well-defined meaning, so the picker simply doesn't offer it for a mixed
selection.

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

## Selecting and acting

Ticking a checkbox **selects** a row; it does not complete it. Once something is
selected, the action bar appears and the editor chooses — the order a mail
client uses, and the reason a tick that silently acted felt wrong.

Selection spans the whole merged list, not one source at a time: tick a task
and a draft together, and **Mark as done** resolves each through its own
source — one Promise per row, so one failing never strands the rest (see
`Promise.allSettled` in `MergedList`). **Ask AI** and **Delete** only show on a
row once it's selected — both are per-row decisions, not a permanent line
under every row.

There is one verb, **Mark as done**, plus **Cancel**. What "done" changes
depends on the source, and the button's tooltip says which:

- A source that returns **`resolve`** from `useItems` completes the item where
  it actually lives, then takes it out of the editor's inbox. `openTasks` closes
  the task for everyone.
- A source without `resolve` can only remove the item from **that editor's own
  inbox**. Nothing changes for anyone else. Neither `unpublishedDrafts` nor
  `upcomingReleases` resolves: publishing a draft has validation, permissions
  and side effects this pane has no business performing, and running a release
  belongs in the Releases tool.

**Open**, **Snoozed** and **Done** are tabs, so a finished or sleeping row never
sits among unfinished ones. In the Done tab the same control reads **Mark as
not done** — a tick is never a one-way door.

Selecting rows in the Open tab also offers **Snooze**, a picker with three
presets — *later today*, *tomorrow*, *next week*. A snoozed item leaves Open
for the Snoozed tab, where **Wake now** brings it back early. Left alone, it
wakes on its own once the chosen time passes — no source involvement, and
nothing changes anywhere outside this editor's own inbox.

A snooze also **wakes early when the item changes** — the same rule a
dismissal follows, and for the same reason: a snooze says "not now, I've seen
this version", not "hide it no matter what happens to it".

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

### Where "done" is stored

In a document scoped to the editor: `_id` is derived from their user id, and the
type is deliberately never registered in your schema, so it stays out of the
structure tool, search and reference pickers.

Sanity's own `/users/me/keyvalue` store would be the natural home — it is where
the Structure tool keeps its pane settings — but it accepts only an allowlist of
Sanity's own keys and rejects anything a plugin writes.

A dismissal also **expires when the item changes**. An item's `changedAt` — its
real modification time, separate from the `timestamp` shown in the row —
doubles as a freshness check, so a draft edited after you ticked it comes back.
Ticking says "I have seen this version", not "never show me this document
again". Omit `changedAt` for anything whose changes your source cannot
observe, and never set it to a future value (a due date, a publish date) — a
future `changedAt` would look "changed" the instant it is ticked and undo the
dismissal immediately.

Snoozes and todos each live in a sibling document of their own — same
per-editor, unregistered-type approach, kept apart because neither shares a
lifecycle with a dismissal: a snooze expires on its own, and a todo has
nowhere else to live at all.

### Recipe: a digest outside the Studio

Nothing this pane shows is private to it — `structureInbox.dismissals.<userId>`,
`structureInbox.snoozes.<userId>` and `structureInbox.todos.<userId>` are
plain, queryable documents in your dataset. That makes a scheduled digest (a
daily "here's what's still open" email or Slack message) a job for a
[Sanity Function](https://www.sanity.io/docs/content-lake/webhooks) — a
separate deployable in your Studio project, not something this npm package
ships or can install for you.

Sketch of what such a Function does, run on a schedule rather than a document
event:

1. Fetch each editor's dismissals/snoozes/todos documents (`*[_type == "structureInbox.dismissals"]`, etc.) alongside whatever your sources actually query (drafts, tasks, releases).
2. For each editor, apply `isDismissed` / `isSnoozed` — exported from `sanity-plugin-structure-inbox` for exactly this, pure and dependency-free, no Studio context required — to work out what is still genuinely open for them right now.
3. Send whatever is left, however you'd send it — the Function is plain Node.js, so any email or chat API works.

This intentionally stays a recipe rather than shipped code: a digest's cadence, channel and formatting are product decisions for your Studio, not this plugin's to make.

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
