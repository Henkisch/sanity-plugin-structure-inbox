# Discord post — Sanity community (#share-your-plugin / #showcase)

---

**sanity-plugin-structure-inbox** — turns the empty Structure canvas into an inbox 📥

Across most of my Sanity projects, the Structure tool ends up being the starting point — the screen every editor lands on first. And it struck me that this empty space could actually be a useful point of entry to work with content, right where the content already is: a draft nobody published, a release quietly stalling, three tasks sitting open, all worth putting right there.

So I built this to put that space to work — drafts, releases, tasks, validation errors, oversized assets, unresolved comments, plus a personal todo list — merged into one sorted inbox, no extra menu item, no new screen to learn.

A few things worth calling out:

- **It's an inbox, not a dashboard.** Open / Snoozed / Cleared tabs, real "mark as done" vs. "acknowledge" semantics depending on whether the underlying thing actually has a resolvable status.
- **Delegation, not ownership.** Assign anything to a teammate — a stray asset, an off-track release — the same way a task board would, whether or not it has one "natural" owner.
- **Personal and team, in one pane.** Your own to-do list sits right next to shared items you can assign out — plus a separate team view for a lead to see who's sitting on what, without touching anyone's private queue.
- **AI where it's actually useful, and nowhere else.** Ask a plain-language question ("what's about the spring campaign?") and it filters your own on-screen rows. Summarize, suggest todos, or spot content gaps — all read-only judgment calls. Anything objectively checkable (validation, broken links, task status) stays deterministic, no AI involved, on purpose.
- **Bring your own sources.** `InboxSource` is a small interface — a few lines of a React hook — so your own custom feed sits in the same merged list as the built-ins.

Requires Sanity Studio v6.

```sh
npm install sanity-plugin-structure-inbox
```

GitHub: https://github.com/Henkisch/sanity-plugin-structure-inbox
npm: https://www.npmjs.com/package/sanity-plugin-structure-inbox

Would love feedback, especially on the AI reads (Ask / Summarize / suggested assignees) — those are the parts most worth stress-testing against a real Studio. And curious if anyone else has felt the same about that empty first screen.

---

## Notes for posting
- Attach `media/hero.png` — the default-vs-with-structure-inbox comparison graphic (see `launch/demo-shotlist.md`) — and the Ask AI gif; a static wall of text won't land in a screenshot-first channel.
- Post in whichever channel Sanity's Discord currently uses for plugin showcases (name has shifted before — check before posting).
- Keep the first line as the hook; Discord truncates long messages behind a "show more" — don't bury the install command below the fold.
