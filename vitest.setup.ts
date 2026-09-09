/**
 * jsdom implements neither of these, and Sanity UI reaches for both: `Grid` and
 * the pane layout observe element size, and popovers/menus match media queries
 * to pick a placement. Stubs are enough — the tests here assert on rendered
 * output, not on live re-measurement, which only a real browser can show.
 */
class StubResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= StubResizeObserver

globalThis.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof globalThis.matchMedia
