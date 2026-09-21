import {describe, expect, it, vi} from 'vitest'

/**
 * `src/index.ts` re-exports every source unconditionally, so importing
 * anything from this package pulls the whole module graph below into scope —
 * even for a consumer who configured neither `openTasks` nor
 * `upcomingReleases`. This mock leaves out `useAddonDataset`,
 * `useActiveReleases`, `useUserListWithPermissions`, `useTools` and
 * `getReleaseIdFromReleaseDocumentId`, the beta/internal/hidden exports
 * those sources reach through `optionalHook`, to prove that omission no
 * longer throws.
 *
 * Everything else here is exactly what the rest of the graph touches while
 * evaluating (`definePlugin`, called immediately in `plugin.tsx`;
 * `defineLocaleResourceBundle`, called immediately in `i18n/index.ts`) or
 * merely references as a binding (`useTranslation`, `useRelativeTime`,
 * `useClient`, `useCurrentUser`, `useSchema` — each only called from inside a
 * component body, never at import time, so a bare function stands in).
 *
 * Twelve names now, up from eleven. Worth flagging rather than quietly
 * growing: plan 008 set a STOP condition at "more than ~10 exports", on the
 * reasoning that a long list here *is* the finding — it measures how much of
 * Sanity's surface the barrel drags in at import time. This plan (060) added
 * `useTools` knowingly and crossed that line. The next addition should come
 * with a reason to move the line, or a reason not to.
 */
vi.mock('sanity', () => ({
  definePlugin: (factory: unknown) => factory,
  defineLocaleResourceBundle: (bundle: unknown) => bundle,
  useTranslation: () => ({t: (key: string) => key}),
  useRelativeTime: () => '',
  useClient: () => ({}),
  useCurrentUser: () => null,
  useSchema: () => ({}),
  // Declared and `undefined`, rather than left off the object entirely:
  // vitest's mock proxy throws on a property it was never told about at all
  // ("did you forget to return it from vi.mock"), which is a test-harness
  // guard rail, not a stand-in for how a real ES module namespace object
  // behaves. A real namespace object returns `undefined` for a property that
  // does not exist — silently, which is exactly the case this test means to
  // reproduce — so these are spelled out as `undefined` on purpose.
  useAddonDataset: undefined,
  useActiveReleases: undefined,
  useUserListWithPermissions: undefined,
  // `@hidden`/`@beta`, reached by `assetIssues` for its media-tool fallback.
  useTools: undefined,
  getReleaseIdFromReleaseDocumentId: undefined,
}))

describe('optionalHook', () => {
  it('returns the fallback for an export the mocked module does not have', async () => {
    const {optionalHook} = await import('./capability')
    const fallback = () => 'fallback'

    expect(optionalHook('useAddonDataset', fallback)).toBe(fallback)
  })

  it('returns the real export when the mocked module has it', async () => {
    const {optionalHook} = await import('./capability')
    const sanity = await import('sanity')
    const fallback = () => 'fallback'

    expect(optionalHook('useCurrentUser', fallback)).toBe(sanity.useCurrentUser)
  })
})

describe('the barrel survives a beta export going missing', () => {
  it('does not throw while importing, and the sources and plugin still work', async () => {
    // The claim under test: none of this throws. If `openTasks.ts` or
    // `upcomingReleases.ts` still bound `useAddonDataset` / `useActiveReleases`
    // by a static named import, evaluating this import would throw here,
    // before any assertion below runs.
    const barrel = await import('../../index')

    expect(barrel.openTasks).toBeTypeOf('function')
    expect(barrel.upcomingReleases).toBeTypeOf('function')
    expect(barrel.unpublishedDrafts).toBeTypeOf('function')
    expect(barrel.assetIssues).toBeTypeOf('function')
    expect(barrel.structureInbox).toBeTypeOf('function')

    // All three sources build without their beta/internal hook present. What
    // each one reports once rendered (an error result, per `openTasks.ts` and
    // `upcomingReleases.ts`, or a missing `assign`/`assess`, per
    // `unpublishedDrafts.ts`) is covered by their own source-level tests, not
    // here — this test is only about the barrel surviving import.
    expect(() => barrel.openTasks()).not.toThrow()
    expect(() => barrel.upcomingReleases()).not.toThrow()
    expect(() => barrel.unpublishedDrafts()).not.toThrow()
    expect(() => barrel.assetIssues()).not.toThrow()

    // `structureInbox` is `definePlugin`'s factory, mocked above as the
    // identity function, so calling it runs the real plugin body.
    expect(() => barrel.structureInbox()).not.toThrow()
  })
})
