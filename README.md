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

A source is a feed of inbox items. Three ship with the plugin:

| Source                                                       | What it lists                                                 | Whose      |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| `openTasks({limit, onlyMine})`                               | Sanity Tasks assigned to you and still open.                  | Yours      |
| `unpublishedDrafts({olderThanDays, limit, types, onlyMine})` | Drafts that have sat untouched long enough to look forgotten. | Everyone's |
| `upcomingReleases({limit})`                                  | Releases that are scheduled or still being filled.            | Everyone's |

Sources choose their column with `placement`. `main` is the wide column on the
left, for work to get through; `aside` is the narrow one on the right, for
context worth seeing but not acting on. `upcomingReleases` defaults to `aside`,
and only the main column counts toward the headline — "three releases are
scheduled" is not three things asking for your attention.

### Whose items are these

Every section says whether its items are yours or the whole team's, because
"done" means different things either side of that line. A source declares it
with `audience`.

- **`openTasks` is personal.** A task is assigned to someone, so `onlyMine`
  defaults to `true`.
- **`unpublishedDrafts` is shared.** A draft left unpublished is usually the
  team's problem rather than one person's, and anyone can pick it up, so
  `onlyMine` defaults to `false`.

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
Sanity's own typings, so they are confined to that one source file. If either
moves, that source stops working rather than the plugin.

### Writing your own

`useItems` is a React hook, so a source can reach for `useClient`,
`useCurrentUser`, or any Studio hook it needs. Each source renders in its own
component, so its hooks get a stable call order and its own error boundary —
one bad query costs that section, not the whole Inbox.

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

**Open** and **Done** are tabs, so a finished row never sits among unfinished
ones. In the Done tab the same control reads **Mark as not done** — a tick is
never a one-way door.

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

Other scripts: `npm test`, `npm run lint`, `npm run format`.

## License

MIT © Henrik Larsson
