import {type SanityClient} from '@sanity/client'
import {cleanup, renderHook, waitFor} from '@testing-library/react'
import {Subject} from 'rxjs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {assetIssues} from './assetIssues'

/**
 * Where an asset row goes when nothing references the asset — the ladder in
 * `openDetail`, one rung per case.
 *
 * Covered here rather than by clicking in `test-studio` for a reason worth
 * recording: the fixture dataset has no orphan asset (every asset in it is
 * referenced under the drafts perspective), and manufacturing one means
 * mutating fixture content other plans verify against. The *used*-asset rung
 * — an `edit` intent focused on the image field — was verified live instead,
 * because that one the fixture can actually show.
 */

const documentType = {name: 'document', jsonType: 'object' as const}
const stringType = {name: 'string', jsonType: 'string' as const}
const imageType = {
  name: 'image',
  jsonType: 'object' as const,
  fields: [{name: 'alt', type: stringType}],
}
const personType = {
  name: 'person',
  title: 'Person',
  jsonType: 'object' as const,
  type: documentType,
  fields: [{name: 'portrait', type: imageType}],
}

const {useClientMock, stableSchema, toolsMock, pushToastMock, useToastMock} = vi.hoisted(() => ({
  useClientMock: vi.fn(),
  stableSchema: {
    getTypeNames: () => ['person'],
    get: (name: string) => (name === 'person' ? personType : undefined),
  },
  // A hook, so each test can decide which tools this Studio has — the whole
  // point of the media rung is that it is not the same Studio everywhere.
  toolsMock: vi.fn(),
  pushToastMock: vi.fn(),
  // Mocked (rather than rendering a real `ToastProvider`) so a "no provider"
  // test can make it throw, exactly like the real hook does when unmounted —
  // `useSafely` is what's under test there, not `@sanity/ui/toast` itself.
  useToastMock: vi.fn(() => ({push: pushToastMock})),
}))

vi.mock('./capability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capability')>()),
  useAssignableUsers: () => ({data: undefined}),
}))

vi.mock('@sanity/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sanity/ui/toast')>()),
  useToast: useToastMock,
}))

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {
    ...actual,
    useClient: useClientMock,
    useSchema: () => stableSchema,
    useCurrentUser: vi.fn(() => ({id: 'user-1'})),
    useTools: toolsMock,
    useWorkspace: () => ({basePath: '/default'}),
  }
})

const navigateUrl = vi.fn()
vi.mock('sanity/router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sanity/router')>()),
  useRouter: () => ({navigateUrl}),
}))

const ORPHAN = {
  _id: 'image-abc123-800x600-png',
  _type: 'sanity.imageAsset',
  originalFilename: 'unused-hero.png',
  size: 9_000_000,
  url: 'https://cdn.sanity.io/images/p/d/abc123-800x600.png',
}

const ORPHAN_FILE = {
  _id: 'file-9f8e7d6c5b4a-pdf',
  _type: 'sanity.fileAsset',
  originalFilename: 'press-kit.pdf',
  size: 12_000_000,
  url: 'https://cdn.sanity.io/files/p/d/9f8e7d6c5b4a.pdf',
}

const OVERSIZED_ASSET = {
  _id: 'image-def456-4000x3000-jpg',
  _type: 'sanity.imageAsset',
  originalFilename: 'hero-full-res.jpg',
  size: 7_500_000,
  url: 'https://cdn.sanity.io/images/p/d/def456-4000x3000.jpg',
  mimeType: 'image/jpeg',
  useCount: 1,
}

function stubClient(orphan: typeof ORPHAN = ORPHAN, oversized: (typeof OVERSIZED_ASSET)[] = []) {
  const fetch = vi.fn(async (query: string) => {
    // The oversized query is the only one distinguishable by an actual
    // parameter name it interpolates, rather than by structure alone.
    if (query.includes('$maxImage')) return oversized
    // The unused check runs only under the asset-count ceiling, so this stub
    // has to answer the count query too.
    if (query.startsWith('count(')) return 1
    if (query.includes('count(*[references(^._id)]) == 0')) return [orphan]
    return []
  })

  return {
    config: () => ({dataset: 'production'}),
    fetch,
    observable: {fetch: vi.fn()},
    listen: vi.fn(() => new Subject()),
    patch: vi.fn(),
  } as unknown as SanityClient
}

const NO_TOOLS: {name: string}[] = []
const WITH_MEDIA_TOOL = [{name: 'media'}]

/**
 * Returns the `writeText` mock itself, rather than leaving callers to read it
 * back off `navigator.clipboard` — asserting on that property access directly
 * trips oxlint's `unbound-method` rule.
 */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const writeTextMock = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', {
    value: {writeText: writeTextMock},
    configurable: true,
  })
  return writeTextMock
}

async function renderSource(options: Parameters<typeof assetIssues>[0] = {}) {
  useClientMock.mockReturnValue(stubClient())
  const source = assetIssues(options)
  const {result} = renderHook(() => source.useItems())
  await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
  return result
}

const openSpy = vi.fn()

beforeEach(() => {
  toolsMock.mockReturnValue(NO_TOOLS)
  useToastMock.mockReturnValue({push: pushToastMock})
  vi.stubGlobal('open', openSpy)
})

afterEach(() => {
  cleanup()
  useClientMock.mockReset()
  navigateUrl.mockReset()
  openSpy.mockReset()
  pushToastMock.mockReset()
  useToastMock.mockReset()
  vi.unstubAllGlobals()
  // `Object.defineProperty(navigator, 'clipboard', …)` (used by several
  // tests below) isn't a `vi.stubGlobal` — `unstubAllGlobals` above doesn't
  // touch it, so a test that defines it would otherwise leak into the next
  // one, which is exactly what the "clipboard API unavailable" case needs
  // jsdom's own absence of.
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('assetIssues openDetail', () => {
  it('gives an unused asset no intent — there is no document to open', async () => {
    const result = await renderSource()

    const row = result.current.items[0]
    expect(row.category).toBe('Unused asset')
    expect(row.intent).toBeUndefined()
    // Without this, `InboxRow` would fall back to select-on-click and the row
    // would be the dead end this whole change exists to remove.
    expect(result.current.openDetail).toBeTypeOf('function')
  })

  it('opens the file itself when the Studio has no media tool', async () => {
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])

    expect(openSpy).toHaveBeenCalledWith(ORPHAN.url, '_blank', 'noopener,noreferrer')
    expect(navigateUrl).not.toHaveBeenCalled()
  })

  it('navigates to a media tool when one is registered, instead of the raw file', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])

    // An absolute path, not `navigate({tool})`: inside a structure pane the
    // router is the structure tool's own scoped one, where a tool-level
    // state change silently does nothing (found live, not in review).
    expect(navigateUrl).toHaveBeenCalledWith({path: '/default/media'})
    // Deliberately no asset id in that path: a guessed route into someone
    // else's plugin is a broken destination dressed up as a working one.
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('copies the filename and toasts a Replace-flavored message for an oversized row', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    const writeText = stubClipboard(() => Promise.resolve())
    useClientMock.mockReturnValue(stubClient(ORPHAN, [OVERSIZED_ASSET]))
    const source = assetIssues()
    const {result} = renderHook(() => source.useItems())
    await waitFor(() =>
      expect(result.current.items.some((item) => item.id.startsWith('oversized:'))).toBe(true),
    )
    const row = result.current.items.find((item) => item.id.startsWith('oversized:'))!

    result.current.openDetail!(row)
    await waitFor(() => expect(pushToastMock).toHaveBeenCalled())

    expect(writeText).toHaveBeenCalledWith(OVERSIZED_ASSET.originalFilename)
    expect(pushToastMock).toHaveBeenCalledWith({
      status: 'success',
      title: 'assetIssues.filenameCopied.title',
      description: 'assetIssues.filenameCopied.oversized',
    })
  })

  it('toasts a delete-flavored message for an unused row', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    stubClipboard(() => Promise.resolve())
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])
    await waitFor(() => expect(pushToastMock).toHaveBeenCalled())

    expect(pushToastMock).toHaveBeenCalledWith({
      status: 'success',
      title: 'assetIssues.filenameCopied.title',
      description: 'assetIssues.filenameCopied.unused',
    })
  })

  it('shows an info toast, not a false "copied" one, when the clipboard write fails', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    stubClipboard(() => Promise.reject(new Error('denied')))
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])
    await waitFor(() => expect(pushToastMock).toHaveBeenCalled())

    expect(pushToastMock).toHaveBeenCalledWith({
      status: 'info',
      title: 'assetIssues.copyFailed.unused',
    })
  })

  it('shows the same info toast when the clipboard API is unavailable', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    // No `stubClipboard` here — jsdom has no Clipboard API by default, which
    // is exactly the case this covers.
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])

    expect(pushToastMock).toHaveBeenCalledWith({
      status: 'info',
      title: 'assetIssues.copyFailed.unused',
    })
  })

  it('never copies or toasts when no ToastProvider is mounted', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    useToastMock.mockImplementation(() => {
      throw new Error('No ToastProvider')
    })
    const result = await renderSource()

    expect(() => result.current.openDetail!(result.current.items[0])).not.toThrow()
    expect(navigateUrl).toHaveBeenCalledWith({path: '/default/media'})
  })

  it('skips the clipboard and toast entirely when the integrator supplies openAsset', async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    const writeText = stubClipboard(() => Promise.resolve())
    const result = await renderSource({openAsset: vi.fn()})

    result.current.openDetail!(result.current.items[0])

    expect(writeText).not.toHaveBeenCalled()
    expect(pushToastMock).not.toHaveBeenCalled()
  })

  it('skips the clipboard and toast on the raw-file rung (no media tool registered)', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    const result = await renderSource()

    result.current.openDetail!(result.current.items[0])

    expect(writeText).not.toHaveBeenCalled()
    expect(pushToastMock).not.toHaveBeenCalled()
  })

  it("lets the integrator's own openAsset win over both fallbacks", async () => {
    toolsMock.mockReturnValue(WITH_MEDIA_TOOL)
    const openAsset = vi.fn()
    const result = await renderSource({openAsset})

    result.current.openDetail!(result.current.items[0])

    expect(openAsset).toHaveBeenCalledWith({
      id: ORPHAN._id,
      type: ORPHAN._type,
      url: ORPHAN.url,
      filename: ORPHAN.originalFilename,
      size: ORPHAN.size,
    })
    expect(navigateUrl).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('opens an orphaned file asset, not just an image one', async () => {
    // `sanity.fileAsset` is the other half of what this source queries, and
    // `test-studio` has no file field anywhere — so this is the only cover
    // the file half of the ladder gets. `url` is the same field on both
    // types, which is why one code path serves both.
    useClientMock.mockReturnValue(stubClient(ORPHAN_FILE))
    const source = assetIssues()
    const {result} = renderHook(() => source.useItems())
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))

    expect(result.current.items[0].title).toBe('press-kit.pdf')
    result.current.openDetail!(result.current.items[0])
    expect(openSpy).toHaveBeenCalledWith(ORPHAN_FILE.url, '_blank', 'noopener,noreferrer')
  })

  it('labels an oversized row by the kind of media it is', async () => {
    // A PDF and a JPEG trip different ceilings, so a flat "Oversized asset"
    // could not say which one was exceeded.
    useClientMock.mockReturnValue(stubClient(ORPHAN_FILE))
    const source = assetIssues()
    const {result} = renderHook(() => source.useItems())
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))

    expect(result.current.items[0].category).toBe('Unused asset')
  })

  it('does nothing for a row it has no asset for, rather than throwing', async () => {
    const result = await renderSource()

    expect(() => result.current.openDetail!({id: 'todo:not-an-asset', title: 'x'})).not.toThrow()
    expect(openSpy).not.toHaveBeenCalled()
  })
})
