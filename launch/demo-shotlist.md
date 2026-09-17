# Media

## What's in `media/`

All captured 2026-09-17 from the `test-studio` `default` workspace, in a framed window on an
ambient background. Cropped to a ~60px bezel and resized to 1800px wide.

| File | Shows | Used by |
|------|-------|---------|
| `hero.png` | The populated inbox: releases needing attention, a failing draft, an asset issue, a task, an unresolved comment, drafts, and personal todos, with the Overview and Upcoming releases cards | README hero, Discord post |
| `ask.png` | One row selected, the action bar (Ask / Snooze / Assign to… / Clear), and an AI answer above the list | README, "Selecting and acting" |
| `filters.png` | The Type filter menu open with two types ticked, list narrowed to three rows | README, "Filtering the list" |
| `cleared.png` | The Cleared tab with two cleared drafts | README, "Selecting and acting" |
| `inbox-pane.png` | The same populated inbox with no window frame, 1800px wide | Spare — good for the Sanity Exchange listing, which sits on its own light chrome |
| `hero-linkedin.png` | `hero.png` padded to LinkedIn's 1.91:1 feed ratio, the ambient background extended by a row-averaged gradient so the seam doesn't show | LinkedIn post |

## Still missing

Nothing depends on these — the README reads fine without them — but they'd each carry a section
that's currently text only:

- The **Assign to…** picker open on a selected row, ideally showing a suggested assignee.
- The **AI insights** menu open, with Summarize / Suggest todos / Find content gaps visible.
- A **Summarize** result card.
- The **Hand off to…** menu on selected todos.
- A short **gif of Ask** filtering the list live. The one static shot can't show the selection
  happening, which is the part that reads as magic.

Set-up for any of these: drafts aged past `olderThanDays`, an open Sanity Task, one release
scheduled and one stalling, a document failing validation, an oversized or alt-less asset, an
unresolved comment thread, and a few todos.
