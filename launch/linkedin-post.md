# LinkedIn post

Written to `launch/voice.md` — read that first if you're editing this.

---

I've built a fair number of Sanity projects over the years, and in most of them the Structure tool is where the editors start their day. It's the first thing they open. And until you click something, the pane next to the list is just empty.

That empty space bothered me for a long time. There's usually plenty worth putting there. A draft someone forgot to publish. A release scheduled for Thursday that's still empty. A task that's been open since last week. None of it is broken, so nobody gets told about it, and it sits there until someone happens to notice.

So I built a plugin that fills it: sanity-plugin-structure-inbox. When an editor lands in the Studio it opens on its own and says "13 things waiting on you and your team", with everything in one list, most urgent first.

Two things I spent the most time getting right:

I didn't want fake completions. If a source can actually confirm something is resolved, you get "Mark as done". If it can't, you only get "Acknowledge", and the item stays open. Ticking a box shouldn't make a problem go away.

And I wanted it to be useful for the team, not just for whoever is looking at it. You can hand any item to a colleague, and a forgotten draft is treated as the team's problem rather than one person's. Your own todo list stays private though — nobody else can read it.

It's open source and free to use. Link in the comments.

#sanity #cms #contentops #opensource

---

## Notes for posting

- Lead image: `media/hero-linkedin.png` — the comparison, pre-cropped to LinkedIn's 1.91:1 feed ratio. **Not** `media/hero.png` (3.93:1 — gets letterboxed to unreadable).
- Link in the first comment, not the body — LinkedIn suppresses reach on posts with outbound links.
- Tuesday–Thursday, mid-morning.
- Everything left out (delegation, AI reads, team view, custom sources) is follow-up material.
