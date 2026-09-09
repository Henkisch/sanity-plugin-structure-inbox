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
import {structureInbox, unpublishedDrafts, upcomingReleases} from 'sanity-plugin-structure-inbox'

export default defineConfig({
  // ...
  plugins: [
    structureTool(),
    structureInbox({
      sources: [unpublishedDrafts({olderThanDays: 7}), upcomingReleases()],
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

A source is a feed of inbox items. Two ship with the plugin:

| Source                                             | What it lists                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `unpublishedDrafts({olderThanDays, limit, types})` | Drafts that have sat untouched long enough to look forgotten. Plain GROQ over your own dataset. |
| `upcomingReleases({limit})`                        | Releases that are scheduled or still being filled.                                              |

### Writing your own

`useItems` is a React hook, so a source can reach for `useClient`, `useCurrentUser`, or any Studio
hook it needs. Each source is rendered in its own component, so its hooks get a stable call order
and its own error boundary — one bad query costs that section, not the whole Inbox.

```tsx
import {type InboxSource} from 'sanity-plugin-structure-inbox'

export function needsReview(): InboxSource {
  return {
    name: 'needsReview',
    title: 'Waiting for review',
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

### What a tick means

Two different things, and the source decides which:

- Return a **`resolve`** function from `useItems` and ticking completes the item where it actually
  lives — closing a task, clearing a flag. The button is labelled "Mark as done".
- Omit it and ticking only removes the item from **that editor's own inbox**. The button says
  "Dismiss from your inbox", because nothing changed for anyone else.

Neither built-in source resolves. Publishing a draft has validation, permissions and side effects
this pane has no business performing, and running a release belongs in the Releases tool.

Dismissals are stored per editor through Sanity's own `/users/me/keyvalue` endpoint — the same
place the Structure tool keeps its own settings. They follow the editor across devices, need no
schema, and write nothing to your dataset. "Show done" brings dismissed items back into view.

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
