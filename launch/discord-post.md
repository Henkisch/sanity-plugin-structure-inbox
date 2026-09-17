# Discord post — Sanity community (#share-your-plugin / #showcase)

Kept short enough to clear Discord's "show more" fold. The screenshots do the explaining.

---

**sanity-plugin-structure-inbox** — turns the empty Structure canvas into an inbox 📥

A draft nobody published, a release Thursday that's still empty, a comment nobody answered. None of it errors — it just sits there. And every editor already lands on the Structure tool, which is blank.

So this fills it: drafts, releases, tasks, validation errors, broken links, oversized assets, comments and a personal todo list — one list, sorted by urgency. It opens by itself and leads with *"13 things waiting on you and your team."*

What makes it an inbox and not a dashboard:

- **No fake completions.** "Mark as done" only where a source confirms a real resolution — everything else is "Acknowledge". Snooze wakes itself, early if the item changed underneath.
- **A queue, not a scoreboard.** Assign anything to anyone. Forgotten drafts default to the team, not one person. Private todos have no team-wide read at all.
- **AI only on judgment calls.** Summarize, ask, find content gaps — all opt-in and click-triggered. Validation, links and task status stay deterministic.

Studio v6, MIT, and `InboxSource` is a few lines of a React hook if you want your own feed in the list.

```sh
npm install sanity-plugin-structure-inbox
```

https://github.com/Henkisch/sanity-plugin-structure-inbox

Feedback very welcome — especially on the AI reads, those are the bits worth stress-testing against a real Studio.

---

## Notes for posting

- Attach `media/hero.png` (the full-width comparison — Discord handles 3.93:1 fine) and `media/ask-query.gif`.
- Check which channel Sanity's Discord currently uses for plugin showcases — the name has shifted before.
- Don't let the install command fall below the "show more" fold.
