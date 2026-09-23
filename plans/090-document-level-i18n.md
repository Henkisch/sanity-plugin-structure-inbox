# Plan 090: Document-level i18n — a language on every row, and a filter for it

## Status

- **Priority**: P2
- **Effort**: M
- **Category**: feature / content i18n (document-level)
- **Depends on**: 089, which provides the `i18n` option, `ContentI18nContext` and
  `translation.metadata` hiding.

## The gap

`@sanity/document-internationalization` makes every translation its own document,
with a language field (`language` by default, configurable as `languageField`). Each
translation's draft is a separate row with the same title, so the rows are
indistinguishable today.

## Steps

1. **`i18n.languageField?: string | false`** (default `'language'`).
   - Add a `languageTypes: ReadonlySet<string>` to the context: the document types
     whose schema declares that field. This auto-detects, so an empty set means
     nothing changes.
   - Memoize on `[schema, languageField]`.
2. **`InboxItem.language?: string`.** It's public, additive and optional. It's an item
   field, not an `InboxSourceResult` capability, so the three-place `SourceFeed`
   wiring doesn't apply.
3. **Populate it** in `unpublishedDrafts`, `documentValidation` and `assetIssues`, only
   for `languageTypes`.
   - Try `"language": @[$languageField]` against a real dataset first.
   - If GROQ won't take a param attribute access, splice the field name after a
     `SIMPLE_FIELD_PATH` check.
   - Comments and tasks don't fetch their target, so leave them out and say so in the
     README.
4. **Badge:** in `InboxRow`'s meta area, a small uppercase mono tag, styled like
   `CountBadge`. Show it on every row that has `language`, whatever the source (the
   memory rule: a per-row pattern goes on every row type).
5. **Language filter**, next to the type and assignee filters in `Inbox.tsx`.
   - Show it only when the open items contain two or more languages.
   - Persist it in pane URL params the way `INBOX_TYPE_PARAM` is (`inboxPaneParams.ts`,
     commit 5545795).
   - Pass it through `matchesInboxFilters`, adding a "no language" sentinel if needed.
6. Tests for each of the above, plus the README.

## Verification

- Add `@sanity/document-internationalization` to `test-studio`, with one type in sv
  and en.
- Check that the badges render, that the filter narrows and round-trips through the
  URL, and that `translation.metadata` is absent.
