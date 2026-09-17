# Discord post — Sanity community (#share-your-plugin / #showcase)

---

**sanity-plugin-structure-inbox** — turns the empty Structure canvas into an inbox 📥

Content work rarely fails loudly. A draft nobody published, a release scheduled for Thursday that's still empty, a comment thread nobody answered — none of it errors, it just sits there until someone notices by accident.

But every editor already lands on the same screen: the Structure tool. And it's blank. So I built this to put that space to work — it opens by itself when an editor lands in the Studio, and the first line they read is *"13 things waiting on you and your team."*

Under it: forgotten drafts, stalling releases, open tasks, validation errors, broken links, oversized assets, unresolved comments and a personal todo list — merged into one list, sorted by urgency then longest-waiting. No new menu item, no new screen to learn.

A few things worth calling out:

- **Proactive, not nagging.** `needsAttention` catches a release that's overdue, or empty and imminent, *before* the date hits. Drafts surface once they cross an age you set. Snooze anything and it wakes on its own — earlier if the item changes underneath the snooze. And when the list is genuinely empty it says "Nothing waiting on you and your team" rather than inventing busywork.
- **It's an inbox, not a dashboard.** Open / Snoozed / Cleared tabs, and real "mark as done" vs. "acknowledge" semantics depending on whether the underlying thing actually has a resolvable status. Cleared is only ever populated by a source confirming a resolution — never by an editor ticking a box.
- **A shared queue, not a scoreboard.** Assign anything to a teammate — a stray asset, an off-track release — the same way a task board would, whether or not it has one "natural" owner. A forgotten draft defaults to `onlyMine: false` on purpose: it's the team's problem, not one person's fault. Private todos have no team-wide reading at all, and there's a separate team view for a lead surveying who's sitting on what.
- **AI where it's actually useful, and nowhere else.** Ask a plain-language question ("what's about the spring campaign?") and it selects your own on-screen rows. Summarize, suggest todos, spot content gaps — all read-only judgment calls. Anything objectively checkable (validation, broken links, task status) stays deterministic, no AI involved, on purpose. Every AI read is click-triggered; nothing fires from opening the pane.
- **Bring your own sources.** `InboxSource` is a small interface — a few lines of a React hook — so your own custom feed sits in the same merged list as the built-ins. `buildDigest` is exported too, if you want a daily Slack/email digest out of a Sanity Function.

Requires Sanity Studio v6. MIT.

```sh
npm install sanity-plugin-structure-inbox
```

GitHub: https://github.com/Henkisch/sanity-plugin-structure-inbox
npm: https://www.npmjs.com/package/sanity-plugin-structure-inbox

Would love feedback, especially on the AI reads (Ask / Summarize / suggested assignees) — those are the parts most worth stress-testing against a real Studio. And curious whether anyone else has felt the same about that empty first screen.

---

## Notes for posting

- Attach `media/hero.png` — the default-vs-with-structure-inbox comparison (the full-width 3.93:1 one; Discord handles wide images fine, so the LinkedIn crop isn't needed here) — and `media/ask-query.gif`. A static wall of text won't land in a screenshot-first channel.
- Post in whichever channel Sanity's Discord currently uses for plugin showcases (name has shifted before — check before posting).
- Keep the first two lines as the hook; Discord truncates long messages behind a "show more" — don't bury the install command below the fold.
