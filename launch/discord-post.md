# Discord post — Sanity community (#share-your-plugin / #showcase)

Written to `launch/voice.md` — read that first if you're editing this.

---

**sanity-plugin-structure-inbox** — puts an inbox in the empty Structure pane 📥

In most of my Sanity projects the Structure tool is where editors start their day, and the pane next to the list sits empty until you click something. That bothered me for a while, because there's usually plenty worth showing there. A draft someone forgot to publish, a release scheduled for Thursday that's still empty, a task that's been open since last week. Nothing is broken, so nobody gets told, and it just sits there.

So the plugin fills that pane. Drafts, releases, tasks, validation errors, broken links, oversized assets, unresolved comments and a personal todo list, all merged into one list sorted by what needs attention first. It opens on its own when an editor lands in the Studio.

Two things I spent the most time on:

I didn't want fake completions. You only get "Mark as done" if the source can actually confirm a resolution — a closed task, for instance. Otherwise it's "Acknowledge" and the item stays in the list. Snoozing works the same way: it comes back on its own, and earlier if the item changed while it was hidden.

And I wanted it useful for the team, not just for whoever is looking. You can assign any item to a colleague, forgotten drafts default to being the team's problem rather than one person's, and there's a separate team view if you need to see who's sitting on what. Todos are the exception, they're private and there's no team-wide reading of them at all.

There are some AI reads in there too (summarise, ask a question about your items, find content gaps), all opt-in and only on a click. Anything with a factual answer — validation, links, task status — stays deterministic, I didn't want AI anywhere near those.

Studio v6, MIT. Writing your own source is a few lines of a React hook if you want something else in the list.

```sh
npm install sanity-plugin-structure-inbox
```

https://github.com/Henkisch/sanity-plugin-structure-inbox

Feedback very welcome, especially on the AI parts. Those are the ones I'd most like to see tested against a real Studio.

---

## Notes for posting

- Attach `media/hero.png` (the full-width comparison — Discord handles 3.93:1 fine) and `media/ask-query.gif`.
- Check which channel Sanity's Discord currently uses for plugin showcases — the name has shifted before.
- Don't let the install command fall below the "show more" fold.
