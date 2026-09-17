# LinkedIn post

---

Content work rarely fails loudly.

A draft nobody published. A release scheduled for Thursday that's still empty. A comment thread nobody answered. None of that throws an error — it just sits there quietly, until someone notices by accident, usually later than they'd like.

But every editor on the team already opens the same screen every morning. In Sanity Studio, that's the Structure tool. And it's blank.

So I built **sanity-plugin-structure-inbox** to put that screen to work. It opens by itself when an editor lands in the Studio, and the first thing they read is: *"13 things waiting on you and your team."*

Underneath: forgotten drafts, stalling releases, open tasks, failing validation, broken links, oversized assets, unresolved comments and a personal to-do list — merged into one list, sorted so the most urgent and the longest-waiting sit at the top. Nobody has to triage it. Nobody has to go looking for it. It's already there.

A few decisions I'm proud of:

→ **Proactive, but never nagging.** It surfaces things before they're a problem — a release that's imminent and still empty, a draft that's crossed the age you set. Snooze anything, and it comes back on its own — earlier if the item changes underneath you. When there's genuinely nothing left, it says so: "Nothing waiting on you and your team."

→ **A shared queue, not a scoreboard.** Assign any item to a teammate — an oversized image, a release going stale — whether or not it has one "natural" owner. A forgotten draft defaults to being the team's problem, not one person's fault. Your private to-do list stays private; there's no team-wide reading of it at all. A separate team view lets a lead see what's sitting where, without touching anyone's personal queue.

→ **Every tick means something specific.** "Mark as done" only appears when there's a real, verifiable resolution behind it (a task Sanity itself confirms is closed). Otherwise it's "Acknowledge" — I've seen this, it's still open. No fake completions, because a queue you can quietly lie to stops being worth reading.

→ **AI is scoped to judgment calls, not facts.** Ask it in plain language what's worth starting first, or what content looks missing from your site. But a broken link, a failed validation rule, a closed task — those stay 100% deterministic. AI never touches anything that already has a right answer.

It's open source, MIT, npm-installable, and built to extend — writing your own source is a few lines of a React hook.

npm install sanity-plugin-structure-inbox

Link in comments. Curious whether others have felt the same about that first screen — what would you put on it?

#sanity #cms #contentops #buildinpublic #opensource

---

## Notes for posting

- Lead image: `media/hero-linkedin.png` — the default-vs-with-structure-inbox comparison, pre-cropped to LinkedIn's 1.91:1 feed ratio with the headline set above it. Use this one, **not** `media/hero.png` (3.93:1 — LinkedIn letterboxes it and the labels shrink).
- Put the GitHub/npm link in the first comment, not the post body — LinkedIn suppresses reach on posts with outbound links.
- Post Tuesday–Thursday, mid-morning, per usual LinkedIn engagement patterns — no data specific to this audience, just the general default.
- If a second post is worth it later, `media/ask-query.gif` (Ask filtering rows live) is the strongest standalone follow-up asset.
