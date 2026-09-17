# Discord post — Sanity community (#share-your-plugin / #showcase)

~850 characters. Written to `launch/voice.md` — read that first if you're editing this.

---

**sanity-plugin-structure-inbox** — puts an inbox in the empty Structure pane 📥

In most of my Sanity projects the Structure tool is where editors start their day, and the pane next to the list sits empty until you click something. That bothered me for a while.

So the plugin fills it. Drafts, releases, tasks, validation errors, broken links, oversized assets, comments and a personal todo list, merged into one list sorted by what needs attention first. It opens on its own when an editor lands in the Studio.

You only get "Mark as done" if a source can confirm a real resolution, otherwise it's "Acknowledge" and the item stays. Anything can be assigned to a colleague. The AI bits (summarize, ask about your items, find content gaps) are opt-in and only run on a click — validation, links and task status stay deterministic.

Studio v6, MIT. Your own source is a few lines of a React hook.

```sh
npm install sanity-plugin-structure-inbox
```

https://github.com/Henkisch/sanity-plugin-structure-inbox

Feedback welcome, especially on the AI parts.

---

## Notes for posting

- Attach `media/hero.png` and `media/ask-query.gif`.
- Check which channel Sanity's Discord currently uses for plugin showcases — the name has shifted before.
