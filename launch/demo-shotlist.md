# Demo shot list

Sequenced as a narrative — capture in this order so the gif/video tells one story: blank canvas → populated inbox → the depth features (AI, delegation, team view). Use the `test-studio` `default` workspace (`npm run build && npm run dev`, http://localhost:3333) unless noted.

Set up test data first: a couple of unpublished drafts aged past `olderThanDays`, one open Sanity Task, one release scheduled and one stalling (empty + imminent), one document failing validation, one oversized/unused/alt-missing asset, an unresolved comment thread with an @mention, and 2-3 todos.

## Hero asset: default vs. with structure-inbox

This is the single most important image — leads the README, and is the lead image on both the LinkedIn and Discord posts. Not two separate screenshots; one composed side-by-side graphic:

- **Left half, labeled "Default"** — same Studio, same `sanity.config.ts` but `structureInbox` commented out of `plugins`. Structure tool open, nothing selected, right-hand pane blank.
- **Right half, labeled "With structure-inbox"** — identical Studio, plugin enabled, same underlying content so the split feels like one continuous canvas, not two different projects. Inbox populated with the same 8-10 mixed rows used for shot 2 below.
- **`showInList: false`** (the plugin's own default) on the right half — no "Inbox" row added to the structure list, only the pane content differs. Keeps the comparison to one variable (blank pane → populated pane); `showInList: true` would add a second difference (a new list item) and muddy the point. Both halves' left-hand structure list should look identical.
- Same browser chrome, same window size, same zoom on both halves — any visual difference should be the plugin, nothing else.
- Composition: vertical split down the middle, or a simple arrow/divider between the two — whichever reads clearly at LinkedIn's feed thumbnail size (small — avoid fine text near the seam).
- Save as `media/hero.png` (already referenced from README.md's hero slot) and also export a version cropped for LinkedIn's post-image aspect ratio (1.91:1 approx) if the two differ.

| # | Shot | Type | Setup | Caption (pairs with README / social) |
|---|------|------|-------|----------------------------------------|
| 1 | Empty Structure canvas ("Default" half of the hero comparison) | Static PNG | Fresh Studio, `structureInbox` **not** yet configured, nothing selected in Structure tool | "Default: the most-visited screen in the Studio, blank." |
| 2 | Populated inbox — merged main list ("With structure-inbox" half of the hero comparison) | Static PNG | Same Studio, plugin configured with 4-5 sources producing 8-10 mixed rows, sorted by urgency | "With structure-inbox: everything waiting on you, one sorted list." |
| 3 | Overview/stats card | Static PNG, cropped to the aside column | Enough open items that the stats card renders (~12+) | "Oldest open item, next wake time, overdue count, by assignee — once there's enough to summarize." |
| 4 | Ask — typing a query | Short gif (3-5s) | Type a natural-language question into Ask, show rows filtering live | "Ask AI: type what you're looking for, not a filter's exact field name." |
| 5 | AI insights menu open | Static PNG | Click the AI insights dropdown, all three items visible (Summarize / Suggest todos / Find content gaps) with their one-line explanations | `media/ai-insights.png` — "Three AI reads, one menu, each explained inline." |
| 6 | Summarize result card | Static PNG | Click Summarize, show the resulting 2-3 sentence card | "What's most worth starting first, in plain language." |
| 7 | Ask AI on a single row | Static PNG (this is `media/ask-ai.png`) | Select a draft, click Ask AI, show the one-line assessment | "Looks ready to publish, or still missing something — one click, no document diving." |
| 8 | Assign to… picker | Static PNG (this is `media/assign.png`) | Select a row from an assignable source, open the picker, show a suggested assignee if visible | "Delegate anything — it doesn't need a natural owner to be worth assigning." |
| 9 | Todos hand-off | Short gif (3-5s) | Select 1-2 todos, open "Hand off to…", pick a name, show them disappear from the list | "Leaving the team? Hand off your open todos instead of losing them." |
| 10 | Snooze with AI suggestion | Static PNG | Select a draft with a real date inside it (event/deadline), show the suggested-snooze button next to the plain snooze icon | "Finds a real date in the document — never a guessed one." |
| 11 | Team view | Static PNG | Open `structureInboxTeamView()`, show items grouped by assignee across the team | "For a lead surveying the whole team's queue, not just their own." |

## Video cut (optional, ~45-60s)
Order: 1 → 2 → 4 → 5/6 → 8 → 9 → 11, with a 1-2s hold on each static frame and the gifs played once. Voiceover/captions optional — the row transitions should read clearly without narration if captions aren't produced.

## Once captured
Drop files into `media/` at the repo root as:
- `media/hero.png`
- `media/ask-ai.png`
- `media/ai-insights.png`
- `media/assign.png`

These four filenames are already referenced from README.md — no README edits needed once they exist.
