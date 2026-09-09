# sanity-plugin-structure-home

Fills the empty canvas editors land on when they open the Structure tool.

Before an editor clicks anything, the right-hand side of the Structure tool is blank. This plugin
puts a Home pane there — recent documents, quick actions, whatever you configure — so the most
visited screen in the Studio starts with something useful on it.

> **Requires Sanity Studio v6.**

## Installation

```sh
npm install sanity-plugin-structure-home
```

## Usage

Add it to `plugins` in `sanity.config.ts`, **after** `structureTool()`:

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {structureHome} from 'sanity-plugin-structure-home'

export default defineConfig({
  // ...
  plugins: [structureTool(), structureHome()],
})
```

Order matters: the plugin works by extending the structure tool that is already in the array, so a
tool that has not been added yet cannot be found. If it is listed first, you get a console warning
and no Home pane.

That gives you a Home item at the top of the root list and, on landing, a Home pane in the canvas.
It has no widgets yet — pass some to fill it:

```ts
structureHome({
  widgets: [
    {
      name: 'welcome',
      title: 'Welcome',
      layout: {width: 'full'},
      component: () => <Text>Anything you like.</Text>,
    },
  ],
})
```

## Options

| Option              | Type                    | Default          |                                                                                 |
| ------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `widgets`           | `StructureHomeWidget[]` | `[]`             | What renders on the pane, in order.                                             |
| `title`             | `string`                | localized `Home` | Title for the pane and its list item.                                           |
| `toolName`          | `string`                | `'structure'`    | Which structure tool to attach to. Set this when the Studio runs more than one. |
| `autoInject`        | `boolean`               | `true`           | Whether to add the Home item to the root list for you.                          |
| `redirectOnLanding` | `boolean`               | `true`           | Whether to open Home when an editor lands on the tool with nothing selected.    |

### Widgets

A widget is a plain object. Write a factory when it takes options:

```ts
import {type StructureHomeWidget} from 'sanity-plugin-structure-home'

export function greeting(config: {name: string}): StructureHomeWidget {
  return {
    name: 'greeting',
    title: 'Hello',
    layout: {width: 'medium'},
    component: () => <Text>Hi, {config.name}</Text>,
  }
}
```

`layout.width` is `small` | `medium` | `large` | `full`, mapped onto a four-column grid that
collapses to one column on narrow screens. Widgets render inside a card the plugin draws, so don't
draw your own — and build the inside with [`@sanity/ui`](https://www.sanity.io/ui) so the pane
follows the editor's theme.

The widget shape mirrors `@sanity/dashboard`'s `DashboardWidget` deliberately, so a widget written
for one surface can move to the other without a rewrite.

## Placing the Home item yourself

By default the plugin adds the Home item to the top of your root list. If you want it somewhere
else — or your structure's root is not a list — turn the injection off and place it yourself:

```ts
import {homeListItem} from 'sanity-plugin-structure-home'

structureTool({
  structure: (S) =>
    S.list()
      .title('Content')
      .items([...S.documentTypeListItems(), S.divider(), homeListItem(S)]),
})

// and
structureHome({autoInject: false})
```

## How it works

Worth knowing, because it explains the one limitation below.

At `/structure`, the Structure tool resolves exactly one pane — the root list. The root's `child`
resolver is never called, so there is no "default child" to render into the empty canvas. What
there is, is a URL. The plugin registers a `studio.components.activeToolLayout` override, which
Sanity renders inside the active tool's own router scope, and from there navigates to the Home
pane's id. The canvas then fills through the ordinary pane-resolution path, and the redirect
`replace`s the history entry so Back still leaves the Studio cleanly.

It stands aside whenever it should: on a deep link, while an intent is still resolving, in other
tools, and when the Home item could not be added.

**Limitation:** automatic injection needs a list at the root of your structure. A structure like
`S.documentTypeList('post')` has no list to add an item to, so the plugin warns, leaves your
structure alone, and turns the redirect off rather than sending editors to a URL that resolves to
nothing. Use `autoInject: false` and `homeListItem` if you need that shape.

## Localization

Strings live under the `structureHome` i18n namespace. Override any of them by registering a bundle
with that namespace in your own `sanity.config.ts`:

```ts
import {defineLocaleResourceBundle} from 'sanity'

i18n: {
  bundles: [
    defineLocaleResourceBundle({
      locale: 'sv-SE',
      namespace: 'structureHome',
      resources: {'home.title': 'Start'},
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
| `noList`  | `/no-list` | A structure whose root is not a list: expect a console warning, a working Studio, no redirect.        |
| `multi`   | `/multi`   | Two structure tools with Home attached to only one of them.                                           |

Other scripts: `npm test`, `npm run lint`, `npm run format`.

## License

MIT © Henrik Larsson
