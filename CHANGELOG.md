<!-- markdownlint-disable --><!-- textlint-disable -->

# 📓 Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [2.2.0](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v2.1.0...v2.2.0) (2026-09-22)

### Features

- give an oversized asset row somewhere to go ([#5](https://github.com/Henkisch/sanity-plugin-structure-inbox/issues/5)) ([f69e51f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f69e51fbd6ebc65d31677dcad5f9276aae82e5e3))

## [2.1.0](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v2.0.0...v2.1.0) (2026-09-21)

### Features

- fill missing alt text from the Inbox, one row or a whole selection ([31a05b8](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/31a05b8ac403b1c3c360fa15b4d1f3624c9b0f54))
- group a link's repeated occurrences, and focus the failing field ([ca42bef](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/ca42befd15fac6e2c055da8eb6deb6d1c88f022a))
- open the offending field, not just the document it lives in ([cd91745](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/cd91745a184e037dc64dd8ae437590040b38f224))

### Bug Fixes

- make a completed fix read as done, and confirm it somewhere that lasts ([127116f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/127116f9d811403095d9b70efb3877490b588662))
- resolve the image asset path for wrapper-object image fields ([fd5c74e](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/fd5c74ef9c1e2c43da0819c32eca11c1b213b28a))

## [2.0.0](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.6...v2.0.0) (2026-09-19)

### ⚠ BREAKING CHANGES

- `showInList` is removed from `StructureInboxConfig`. The
  Inbox entry is always added to the root list, because on a collapsed pane
  layout it is the only way in and a structure cannot know the viewport at
  serialization time. Use `inboxListItem(S)` to place the entry yourself —
  the plugin detects it and does not add a second one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NHZLZkTNqb8n82avDjV6QK

### Features

- land on the root list on mobile instead of trapping editors ([539b067](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/539b0674a9f9d108a3c56786c96e34611ed2c14e))

## [1.0.6](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.5...v1.0.6) (2026-09-18)

### Bug Fixes

- require sanity ^6.10.0, the first release with @sanity/ui v4 ([b13092f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b13092fb4a77de0e96c48020d0d17867274b9a60))

## [1.0.5](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.4...v1.0.5) (2026-09-18)

### Bug Fixes

- stop a per-render item value from looping useStableItems ([c301585](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c30158503fb3aeb58eb0ed92b38d5474e73a8064))

## [1.0.4](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.3...v1.0.4) (2026-09-18)

### Bug Fixes

- stop an unmemoized source's items from looping the pane ([478e05a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/478e05aef7b1a4f829a259495dea581b0eccd855))

## [1.0.3](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.2...v1.0.3) (2026-09-17)

## [1.0.2](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.1...v1.0.2) (2026-09-17)

## [1.0.1](https://github.com/Henkisch/sanity-plugin-structure-inbox/compare/v1.0.0...v1.0.1) (2026-09-17)

### Bug Fixes

- stop unpublishedDrafts showing a raw document id as its row title ([8a5ae21](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8a5ae21574f972f1befa6e71179f6a101410b373))

## 1.0.0 (2026-09-17)

### ⚠ BREAKING CHANGES

- InboxSourceResult.assess now returns Promise<InboxAssessment>
  ({message, tone?}) instead of Promise<string>. The package has no npm release
  yet, so this is taken as a clean break rather than an overload -- see
  plans/README.md's own standing note on why that window is worth using.

`tone` colours the assessment's own card (Text has no tone prop in this
design system) and deliberately never affects InboxItem.tone or the merged
list's sort -- an assessment is the model's opinion about a document, a row's
own tone is a fact its source computed, and the list's order stays
deterministic and explainable regardless of what any assessment says.

Where a source already knows the real severity deterministically (a link-
checker finding's kind/status, a task's own overdue-ness), tone is set
locally instead of asking the model to re-derive a fact already in hand --
only unpublishedDrafts.ts, which has no such signal, actually asks Agent
Actions to judge tone.

New AssessmentUnavailableError distinguishes "the model answered but not
usably" from a real transport failure, so the row can say assess.unavailable
instead of the generic assess.error.

Drive-by: FixProposal/TodoSuggestion/SuggestTodosState were never exported
from the package barrel despite being public types already part of this
contract -- fixed alongside the new InboxAssessment export.

Verified live: a real draft's "Ask AI" rendered a tone-coloured card with a
specific, correct read ("The announcement body is missing.").

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MsANSRHRbmZzzoPezssU5F

- rename to sanity-plugin-structure-inbox

### Features

- add "Find content gaps" — an opt-in AI read of the project's own content ([dc13a30](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/dc13a30d0a5d49851e48032aced8237d1c939121))
- add a live badge to the Studio navbar ([4397d0f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/4397d0fddad4b55cffc191acef6a0f7b69335bad))
- add a pure diff helper for departed editors' leftover state ([4cbccc5](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/4cbccc5afdfb2e7ebc28eac982077590148c9166))
- add a pure groupByAssignee helper ([12d0a27](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/12d0a2710db85669bb068bf481625e16c58b67bd))
- add an opt-in Inbox source for sanity-plugin-link-checker ([0830e75](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/0830e75afbf8a92c8c4625c6b380be554ce9e95f))
- add assetIssues source — oversized, unused, and missing-alt-text assets ([fa0f26c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/fa0f26cc96c0c0abfb92037858691cdf6adb07e4))
- add buildDigest to combine sources and editors into open lists ([abea356](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/abea3567f35adde97d134ed49d2f9863f763137c))
- add bulk "save to todos" selection action ([f123db1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f123db10d7a1d123d53a33fbae8339f76cddd704))
- add demo screenshots and gifs for launch content ([8b395e9](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8b395e95b30a8121546e667df5ddc30cc1763c1e))
- add snooze and a personal todos source to the inbox ([3e59a40](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/3e59a40c5cf48ed169d7f0ffc66132f1ea8bbf75))
- add unresolvedComments source — Growth-plan-and-above comments, broadly supported ([7ce722a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7ce722ab421347b6774c3a4c82df5b8f1eb9fa71))
- Agent Actions insights, Gmail-style selection bar, and a real Open/Cleared lifecycle ([18c7b95](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/18c7b9588e5bebfbfd7bbb0d7d23837bc52e22b0))
- AI-suggested snooze date from document content (plan 023) ([6b86fe4](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/6b86fe47e6806d45d6f78df02a0580ca04c16056))
- AI-suggested todos, repurposing the "Ask AI: what to work on first" link ([c8f444c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c8f444c58312b4310626154a56f143cc9efb4512))
- ask the inbox -- select rows by asking a plain-language question (plan 022) ([c23806d](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c23806d8dd51942d274aa2f987a90e96a0a687d4))
- assignee avatars, todo edit dialog, and inbox row consistency polish ([decd612](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/decd6125781388cb764940ea8b80a5f77d78dffa))
- cache AI assessments against changedAt (plan 021) ([5eb7d2b](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/5eb7d2b0640bed3b049c98bf0a8c4d9174eae554))
- catch poor-quality and wrapper-object alt text ([a52c2de](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/a52c2de3b6b9d312adcd06d9e1fa42f654b5db03))
- export buildDigest from the package entry point ([f0bc2d9](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f0bc2d91f1e5f57153d227690252d7ad92eca623))
- export findStaleEditorDocuments from the package entry point ([e4cf195](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/e4cf1952677089fbb16eb56af27b57f37ecd66ee))
- expose useInboxOpenCount via a shared layout provider ([0092d91](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/0092d9129ecff881bf3aa0d682ace82975290f49))
- feed Ask the same automated content survey Find content gaps already uses ([9024f0a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/9024f0aeaeb4ba131083e3e39ea144aada1fbc5c))
- fill the empty Structure canvas with a Home pane ([97387c5](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/97387c55f43e71a414be4f2db47db232d24c86b0))
- Fix with AI (broken reference retarget), task detail open, and a live-query reconnect bug ([c82d2f2](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c82d2f281574c16b97cc98c234e969d47e36b903))
- Fix with AI for broken links, plus three Inbox polish fixes ([b12011b](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b12011b4ebf5869b871ecbf48b4f42fa519e498e))
- fold Ask into the checkbox row on wide screens, fix header padding ([173c213](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/173c2138b4785537e76b74b5ef540559078a3b53))
- give Agent Actions a shared client and JSON parser (plan 019) ([69f10f5](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/69f10f5260c3d079cc81c72846f1efa94a24b283))
- give Cleared real content, and stop double-counting it elsewhere ([e28c6eb](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/e28c6eb4f047ae86514135c88c74773b050049a9))
- give rows a hover cue, match aside list spacing to the main list ([a3328c3](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/a3328c379b055686e174b74c6afbab1aa4c3f357))
- give the assignee filter a Jira-style "+N" overflow menu ([8d56891](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8d568914d8fcf968d7e701d682de7c095829eddb))
- ground every AI read in a shared project context, add a name greeting ([3ddaeda](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/3ddaeda7920fb23382b1d0ae13760aee37e3d7a9))
- improve selection UX and add undo for mark-done/snooze ([2218e06](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/2218e067ac1f0bf90caf685e33d657a7bf3ebb34))
- keep inbox sources live, add AI triage and assign, redesign as one merged list ([bfdf898](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/bfdf8983f4caacdc8c25e0a9e66e4081fc399618))
- let a release row open the release itself, not sit inert ([f03c110](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f03c110c8a57dc5f6d41959729541ed3624efedb))
- let a source offer a cheap open-count path alongside useItems() ([8d47fc3](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8d47fc3db9265c7e603593922cb40a4d66eebc0c))
- let an integrator disable Summarize/Suggest todos individually ([8850baa](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8850baa8aec5fa6b9bef528631036e4ea0657c92))
- let assess return a tone alongside its message (plan 020) ([8dfae9e](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8dfae9ee2f83caaa1b6966b0542dbc77af9ee8ca))
- let editors hand off their own todos, with per-row pickers naming the verb ([1b4a834](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/1b4a83415f12a8a7c6511e228c2ab40c8517a601))
- make Ask's answer dismissible and mark it as AI-sourced ([b92ac39](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b92ac392ca89166463651770999515df3925144b))
- make assignment delegation-based, not owner-based, across every shared source ([b927701](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b927701b40305693dbec335351c252b67c1c2293))
- make the pane an inbox instead of a widget dashboard ([553e70d](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/553e70d66a81958bca3b04afd5807e3893a480fb))
- openTasks assess, and consistent 20px spacing across the pane ([8d4df81](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8d4df81da24a5574bc92ff686ad39d7f6336fd82))
- prep launch content — README hero/badges, social drafts, demo shot list ([e33fb29](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/e33fb29ce75ef830192a7db2e4981c68c07a3c6c))
- promote off-track releases and stalled schedules into the main column (plan 027) ([6da61c7](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/6da61c7d076ba6544182cc04d5269291841763eb))
- reach the Home pane without adding a menu item ([1235440](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/123544019dd79df73d47de34b825e1f34b925d53))
- redesign the Inbox header — multi-select filters, persistent stats sidebar, combined add menu ([d7d8db5](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/d7d8db562951e8f66c0c13bb888e11c3866eb53f))
- ship the team-wide assignee view as a real Studio tool ([2001fef](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/2001fef0a1e0cd2d101e495ffb3a1f99566c17b4))
- show a checkmark on the active type filter ([79a73be](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/79a73beae5c9c5ff800c885b4a6f2bd60005bcd2))
- show a count badge instead of a blue fill on the type filter ([033b920](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/033b920e477d293a8042086acb29ed3e3a95b489))
- show the assignee's name in the row meta line ([b3d64ea](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b3d64ea9d6e2880574f1894e85926c2ae16c14e1))
- split resolve from acknowledge in the selection bar ([43c516e](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/43c516eaf09fb6d7b53e159a299bf3b8f65d4bb7))
- suggest an assignee from the transaction log, no LLM (plan 024) ([3d5632a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/3d5632ad676560e64ac436be794029b5257001ff))
- surface drafts currently failing their own schema validation ([efc182d](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/efc182d0d179249089e8203332e42c77be4b0fa7))
- tailor the headline to who the assignee filter actually names ([05c8467](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/05c84673dd2c41d3a75cc2aecf99e0a19f0ee6f3))
- tasks source, shared-vs-personal labelling, and Open/Done tabs ([070ceac](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/070ceacc3cdea792c7dd113ae93b203a4fbf2970))
- two-column layout, and select-then-act instead of tick-to-complete ([17e66ef](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/17e66efad8110e83231787f043af3bd8cb452dca))
- wrap Team/Only you group counts in a rounded badge ([b42a01a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b42a01a7d315ec644890a9179dda6a1a270fbaca))

### Bug Fixes

- add a pulsing status dot to the pane heading, revert source grouping ([f6b9e29](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f6b9e29cb830e9a9ef8ec74ba4a61dc7f65ba027))
- assign/unassign now update immediately, instead of sometimes needing a reload ([6d200d0](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/6d200d0721a3e063accf5b599085b2483f51cbb0))
- cap openTasks' open and recently-closed tasks separately ([915d09c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/915d09cdc6cdfbb5cd31c98a0ae56728353beda8))
- cap the Inbox list at the sidebar's actual rendered height ([25b91ad](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/25b91ad51b8cd015179a514882ff1aa55fa4aef2))
- catch a failed document-count fetch instead of letting it crash the whole card ([6e4b1ee](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/6e4b1eee87b9e12c876882d2c8f10edd70730a8d))
- close the same-tick double-click race for InboxRow's AI handlers too ([7880d44](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7880d4485f628cd7b888e16e57a1cbd04e8ab7f1))
- close the same-tick double-click race for the other four AI handlers ([b026f07](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b026f07ccd858928538b06f3b391476a742d99f7))
- collapse the toolbar's 3 AI reads into one menu, fix result-card spacing ([b9ce938](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b9ce938e88dff355c0e47ceeb47155d9df341d8d))
- contain a throwing source to its own card ([52448dd](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/52448ddb2ca399dd82de4e37c2235f47758e422d))
- correct row hover color, match aside row padding to the main list ([1233023](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/12330239074f177539ed8993c66af8b4283eb933))
- do not let a late dismissals load drop a tick ([ce71f7a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/ce71f7a0107a0df3989fc9fda3ef66cd5c043b82))
- don't clear the persist-dirty flag until a write actually succeeds ([dbac4df](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/dbac4dfa06456de1f197401de14efd9f596811a9))
- even out AI-result card padding, level the greeting dot, use real doc-type icons ([bdea601](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/bdea601ed6e3cc8c5bb1cf6bc34cfa57c136bf2c))
- exempt named sources from the dismissal TTL ([8bb9a29](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8bb9a291f11f18a10c5509b6ebe098d9a96ce871))
- exempt todos from the dismissal TTL ([75920b1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/75920b1ac9415ed1df73fd4ad2cbf113456598fc))
- fix responsive selection bar, confirm task target shape, add todo dialog with description/due date/delete ([acbb3ec](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/acbb3ecbf3b010902862d10c1a7264f39d8dde69))
- give needsAttention real assign, sharing upcomingReleases' own record ([5453810](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/54538109329dec5199ef67f844d851b3b18a7f93))
- give per-row assess/fix failures the same tone-card treatment successful tone results already get ([2a9958a](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/2a9958af15a34c9f520ab408e79d07561bc1864a))
- give SectionCard's error state the same critical tone every other error uses ([e2b61dc](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/e2b61dc70ae3fbe657bf6b9913d44f9394fae5fe))
- give the 4 remaining Dismiss buttons the same corner-flush nudge their siblings already have ([0f705f6](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/0f705f6876a2839c62e86dc8c8b9926ffbdd8efe))
- give the assignee-suggestion lookup visible loading/error/none states ([117e16f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/117e16fcaab223cf7fbc2c092481bc62b37f61e1))
- give the inbox pane a native-feeling header, and group sources into one box per column ([a025cbd](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/a025cbdf2dc974f2ad9909df53ded7eb8020e141))
- guard assetIssues' GROQ field-name interpolation the same way linkCheckerFindings does ([ca13870](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/ca13870eca0069f9896c69c16e4b4e0f6d764532))
- guard transferTo's write with a revision check and retry, instead of a blind overwrite ([35ab0a2](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/35ab0a2bde5948daa05f8267943ecb40c7eb4bd7))
- honour showInList and the redirect for async structures ([9155298](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/9155298c440e905db5dbab7d8ac7d3c5ef6fe701))
- ignore a stale AI response when a newer request has already started ([746a72c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/746a72c5c0d33310f5cea41b94bbabd50f5e948d))
- keep items dismissed when their timestamp is a due date ([a41521c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/a41521c2862f387863c97cc8bd17a789eb039fd2))
- keep the assignee avatar full-size in compact (aside) rows ([987b7b9](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/987b7b91e58290fbae69e5b95711f1e4886576bb))
- key assignee identity by id, not display-name text ([eb4c62e](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/eb4c62e907f285b22694040c91f6b261593bd091))
- let the Inbox pane flow full-width, fix Overview text clipping, add count badges ([1ef4078](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/1ef40787777c036c23393ab9e5649c2078c38610))
- make suggestSnooze click-triggered, not automatic on row selection ([b8b1ad3](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/b8b1ad3fc6dfdd9277c8303a21d036b2508ff4d6))
- make Team/Only you count badge fully rounded, not just soft-cornered ([24f147d](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/24f147dd991e34fd3c2cdee64afcb487621d32ab))
- make the avatar-stack ring track the theme instead of dark mode ([7d15029](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7d15029b6e883a04d3139764914c49f1e115abc9))
- match "Add content" button size to its toolbar neighbours ([029dc3f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/029dc3f0beb993d8e197fb271737af201f5909e3))
- match header/content horizontal padding responsively, not to a fixed 20px ([f4e7c4d](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f4e7c4dcdc10e50a8665964dd24746b787d77769))
- match InboxStats' header height to SectionCard's real, confirmed-live value ([c4a8c4e](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c4a8c4e8e9594d68d751522106480ca28455c583))
- move Ask's answer into the results area, more top padding, header alignment ([319a5d0](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/319a5d0d3497558a868946bafeb6baf1a5617b6a))
- move handleApplyFix's real write out of the setFix updater ([7c5d8c1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7c5d8c132c7d250ee13c1a0b7d72f1cd4855bc90))
- open the exact comment thread, singularize the row's own category ([d1b2348](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/d1b2348cad4ff0cee570009400838cae8ed106bb))
- over-fetch before filtering onlyMine drafts, so a real match isn't missed ([9ce3542](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/9ce3542e8746b48ebee7fd1126097de6bcd1d4c6))
- over-fetch before filtering unresolvedComments to onlyMine, instead of after the query's own limit ([97ab149](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/97ab149726ea6551bbb03c8d7d786521d78644cf))
- parameterize assignmentStore's GROQ query, and stop a rejected write from rolling back a newer one ([6c8e44f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/6c8e44fd8708cfac92ca14c3622865310565b1e0))
- pass a task's own title as an instructionParam, not spliced into the instruction string ([2e142b5](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/2e142b5463461ca9271049c241ae15aa652864a7))
- pass action.icon through to the aside column's own action button ([3120f3c](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/3120f3ca9d9ec437eb89a22abd123b7eb73b9c75))
- pass exempt source names from Inbox into useDismissals ([d367e48](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/d367e480e62a8b5270bf0c88129e1e04bf554055))
- put the leftmost avatar on top of the avatar-stack, not the rightmost ([21f431b](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/21f431bc22d1ab6929797235f2eee6ebc7ce49c4))
- rebuild hero comparison at native resolution, no letterboxing ([315deb0](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/315deb0a86cb49e81c9c9cb76a94228926070ee9))
- recapture detail screenshots as tight zoom crops, not full pages ([434a738](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/434a738cca68c568ec0560fba081ee0f0151b940))
- remove the "Try again" button — it never did anything ([ab348f1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/ab348f1b9d55b643e3ce041973154034f84a0251))
- rename to "AI insights", add wrapping hints, drop redundant icons ([173e1dc](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/173e1dc3322f5a8be82274c6021f65925a31c9ad))
- render AI results under their own toolbar, not above it ([18f6f13](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/18f6f13241028492c37ef83219bc68d1cf9246a2))
- reopen was never wired through SourceFeed, so "Mark as not done" did nothing ([37645b1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/37645b1e5421f62c372ce68b4009ea1a09f66f46))
- replace the bulk assign/transfer picker's native <select> with MenuButton ([f67afea](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/f67afeab4d4175ad32b75ac021836b007839372c))
- right-justify the header's avatar/filter cluster ([ea2aa61](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/ea2aa61572a9cc136535d36ffb5637e53cc0c5e6))
- route default source titles and openTasks' Overdue/Due through real i18n keys ([7e9144b](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7e9144bd083dff58187b0686f1b2831f44a893e6))
- row hover was a border ring, not a background tint ([8c5c159](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/8c5c1599e83feccce5057fad145f9c18d59e78d0))
- seed CreateItemRow's fields on the very first render into edit mode ([e509cd1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/e509cd1a64e53b8e14e3f018d6010572ec21d13c))
- show a real loading indicator on the AI insights button ([3e5d3a1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/3e5d3a197cc401d743dd4fbb3ba1f9bc13e30220))
- standardize every count badge to one fixed-size, mono-font shape ([87189ec](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/87189ecce15a51f8f64d0da2b69a26dbf11d1812))
- stop a rapid double-click from sending the same AI request twice ([03827ce](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/03827ce3f5346ef16f5dd3f1e75de44998cd5184))
- stop allocating a fresh Date every render in RelativeTime ([886f2e4](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/886f2e4c11c7274b4afcba6b74dd9d48fe4a600e))
- stop deriving the Overdue stat from the generic severity tone ([83d3580](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/83d3580a36caf41681611a0f9cccf13ba3af31f6))
- stop double-scrolling the inbox list once the columns stack ([c4b5570](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/c4b5570463e29c94b0da893aa70b335864627362))
- stop giving Ask its own boxed header treatment ([9284fd2](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/9284fd20a9f305f1ad01e89cbd1fe293f7d1eca5))
- stop registering link-checker's own Studio tool, it isn't needed ([7f29652](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7f29652aa84e524a24f27af34837138021befc0c))
- stop rendering an empty results box when nothing is active ([5464236](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/54642364b099ca6d8912f9973860a9dcf11a7552))
- stop the inbox subtitle from repeating the heading ([4ee185f](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/4ee185f498fb929b02001716f4264e81313b94e7))
- survive a Sanity release that moves a beta hook ([0266cb4](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/0266cb479097f0404baa16431a23681b8892ee6a))
- thread neverExpireSources through useDismissals ([1e0e162](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/1e0e16259863d5f8551ab803017873243b91d0e7))
- truncate a long assignee name instead of letting it push its count off-card ([7964981](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/796498190dfc5db72fd1ef4560dedf919221281c))
- widen avatar-stack overlap so the cutout ring is visible ([7ee77ce](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/7ee77ce2fbd503b5e70527a3a39c1c996a71b799))
- widen test timeouts that a slow CI runner blew past 3 runs straight ([5b224bf](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/5b224bf270ce98980c1eb32f83da757848f8055b))
- wrap save-to-todos create call for synchronous sources ([dde69b2](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/dde69b26707696f2f6df168037f84c1bc3197bfd))

### Performance Improvements

- stop computing mergeRows for the same view more than once in Inbox.tsx ([fcfaf02](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/fcfaf02f23c9c2f02454111aa20deff2ad9f1a0a))
- stride-sample contentGaps' project survey instead of literal top-5 ([049bb33](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/049bb33ac937f2c9beff504bdb539b76c3a05ede))

### Reverts

- pull the navbar badge (plan 017) ([263c8f1](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/263c8f13ffb561e498e6ca063df5de1c60ebfa7e))

### Code Refactoring

- rename to sanity-plugin-structure-inbox ([60b5743](https://github.com/Henkisch/sanity-plugin-structure-inbox/commit/60b574328011a77caf7c0898034e29eea9ec0a8e))
