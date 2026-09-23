# Plan 089: Localized titles crash the Structure tool

## Status

- **Priority**: P1. A customer Studio crashed.
- **Effort**: M
- **Category**: bug / content i18n (field-level)
- **Depends on**: none. It is followed by 090 (document-level) and 091 (preview-store titles).

## The finding

On a Studio using `sanity-plugin-internationalized-array` with `unpublishedDrafts()`
enabled, opening Structure shows "The structure tool crashed":

```
Objects are not valid as a React child (found: object with keys {_key, _type, language, value})
```

- `unpublishedDrafts` projects `coalesce(title, name, label)`. For a field-level
  translated type, that returns the array.
- `toItem` then passed it through as `title: row.title || typeName`, and `InboxRow`
  rendered it as a child of a `<span>`.
- The main column had no boundary below the pane. `BoundedSourceFeed` wraps only the
  headless `SourceFeed`, not the rows `MergedList` draws, so one bad row unmounted the
  whole Structure tool.
- `assetIssues` had the same hole:
  - both alt-text queries assigned `title: doc.title`
  - `safeTitle` reached `suggestAltText`'s `.trim()`
  - worse, on a localized **alt** field `proposeFix` would have patched a plain string
    over the array
- `$types` defaulted to `null`, so drafts of `sanity.*` types, of
  `translation.metadata` and of types removed from the schema were listed too.

## What was done

- **`src/i18n/contentText.ts`:** `toDisplayTitle` / `pickLocalized` read a string,
  an internationalized array (`language`, or `_key` on older data), a
  `localeString` object or Portable Text as text. The language preference is:
  1. exact match
  2. bare language (`sv-SE` → `sv`)
  3. any language that has text

  Objects never guess a language, and `strict` disables step 3.
- **`i18n.languages` plugin option:** it travels to sources through
  `ContentI18nContext`, which `createInboxCountLayout` provides. That layout wraps the
  whole Studio.
  - `useContentLanguages()` defaults to the Studio locale.
  - `useContentWriteLanguage()` is only ever the configured first language. A UI
    locale is no proof of a content language.
- **Titles:** `unpublishedDrafts`, `documentValidation` (`draftMeta`) and both
  `assetIssues` alt checks now route their titles through `toDisplayTitle`.
- **`SourceFeed.normalizeItemText`:** every source, integrators' included, reports a
  string `title`/`subtitle`.
  - When nothing needs fixing it returns the same array by identity, per the AGENTS.md
    churn rule.
  - It fixes only the offending items and calls `warnOnce` for each source.
- **Boundaries:**
  - `RowBoundary` around every row, in both `MergedList` and `InboxSection`.
  - A pane-level `SectionErrorBoundary` in `InboxPane`.
  - `SectionErrorBoundary` gained a `label` prop.
- **Hidden types:** `HIDDEN_TYPE_NAMES = {'translation.metadata'}` is checked by
  `isHiddenType`. `unpublishedDrafts` and `documentValidation` default `types` to
  `getRealDocumentTypeNames(schema)`.
- **Localized alt fields:** `altFieldShape` returns `string`,
  `internationalizedArray` or `localized`.
  - **Missing:** no language has text.
  - **Poor:** classified in the preferred language.
  - **Fix:** writes `[{_key: lang, _type: '<type>Value', language: lang, value}]`, but
    only when `i18n.languages` is set and every existing entry is empty (the re-read
    guard).
  - **`localized` shapes:** never written.
  - **`AltContext.language`:** tells `describeImage` which language to write in.

## Verification

- Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
- New tests:
  - `contentText.test.ts`
  - `assetIssues.i18n.test.tsx`
  - the crash payload in `unpublishedDrafts.test.ts`
  - `normalizeItemText` and the integrator-source path in `SourceFeed.test.tsx`
  - "a row that throws keeps its siblings" in `MergedList.test.tsx`
  - `translation.metadata` in `projectDigest.test.ts`
- `.d.ts`: `grep -c "^declare global {" dist/index.d.ts` still prints 3.
  `wc -l dist/index.d.ts` went from 1,312 to 1,371, which is the new option type and
  `AltContext.language`.
