# LinkedIn post

---

Across most of my Sanity projects, the Structure tool ends up being the starting point — the screen every editor lands on first. And it struck me that this empty space could actually be a useful point of entry to work with content, right where the content already is.

A draft nobody's published yet, a release scheduled for tomorrow that's still empty, a task assigned three days ago — all worth surfacing right there, the moment the editor opens the Studio, instead of waiting to be found.

So I built **sanity-plugin-structure-inbox** to put that space to work: it turns that first screen into an actual inbox — drafts, releases, tasks, validation errors, broken assets, unresolved comments, a personal to-do list — merged into one list, sorted by what actually needs attention first.

A couple of decisions I'm proud of:

→ **Every tick means something specific.** "Mark as done" only shows up when there's a real, verifiable resolution behind it (a task Sanity itself confirms is closed). Otherwise it's "Acknowledge" — I've seen this, it's still open. No fake completions.

→ **AI is scoped to judgment calls, not facts.** Ask a plain-language question and it filters your own list. Get a one-paragraph summary of what's most worth starting today. Ask it what content might be missing from your site. But a broken link, a failed validation rule, a closed task — those stay 100% deterministic. AI never touches anything that has an actual right answer.

→ **Delegation over ownership.** You can hand any item to a teammate — an oversized image nobody's fixed, a release going stale — the same way a task board would, whether or not that thing has one "natural" owner.

→ **Your own work and the team's, side by side.** A private to-do list sits right next to shared items you can assign to a teammate — and a separate team view lets a lead see who's sitting on what across the whole project, without touching anyone's personal queue.

It's open source, npm-installable, and built to extend — writing your own source is a few lines of a React hook.

npm install sanity-plugin-structure-inbox

Link in comments. Curious if others have felt the same about that first screen — what would you put there?

#sanity #cms #contentops #buildinpublic #opensource

---

## Notes for posting
- Lead image: `media/hero.png` — the default-vs-with-structure-inbox comparison graphic (see `launch/demo-shotlist.md`), not a single screenshot.
- Put the GitHub/npm link in the first comment, not the post body — LinkedIn suppresses reach on posts with outbound links.
- Post Tuesday–Thursday, mid-morning, per usual LinkedIn engagement patterns — no data specific to this audience, just the general default.
