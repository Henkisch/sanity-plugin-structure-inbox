# Fixtures

Files here are **not** loaded by the Studio automatically. They are uploaded by
hand, once, to give this workspace content that the plugin's sources need in
order to be exercised at all.

## `example-press-kit.pdf`

A real PDF (~17 KB, generated with `cupsfilter`), for `assetIssues`' **file**
asset half.

`assetIssues` queries `sanity.imageAsset` *and* `sanity.fileAsset`, but this
workspace had no `file` field and no file asset anywhere — so every
file-related code path went unverified until someone asked whether it worked.
`post.pressKit` is now that field, and this is the file for it.

To use it:

1. Open any **Post** in the Studio.
2. Scroll to **Press kit (PDF)** → `···` → **Upload** → pick this file.
3. The Inbox's asset rows now include a file asset. With
   `maxSizeBytes: 10_000` (see `sanity.config.ts`) it also trips the oversized
   check.
4. Clear the field afterwards to leave the asset **unreferenced** — that is
   how you get an orphan, which is the case `openDetail`'s fallback ladder is
   for, and one this dataset otherwise has none of.
