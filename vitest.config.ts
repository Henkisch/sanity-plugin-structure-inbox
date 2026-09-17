import {defineConfig} from 'vitest/config'

export default defineConfig({
  // The package's own tsconfig leaves JSX untransformed for pkg-utils to
  // handle, so tests have to name the runtime themselves.
  esbuild: {jsx: 'automatic'},
  test: {
    // Widgets render Sanity UI and the redirect hook drives a router, so the
    // meaningful units here are DOM-bound. The pure helpers run happily in
    // jsdom too, so there is no reason to split environments.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    globals: false,
    // Default (5000ms) was tight enough that a purely synchronous
    // MergedList.test.tsx test (no await, no waitFor — just fireEvent +
    // getByText) timed out consistently on GitHub's shared CI runners
    // (all 5 OS/Node combos, same test, twice in a row), while passing
    // locally every time. Not a hang: CI's shared CPU just makes jsdom
    // rendering itself slower than local hardware. 15s gave that headroom
    // for a while, but Inbox.test.tsx's `handleSuggestTodos` batching test
    // (real timers, two real promptJson calls) later blew past 15s on the
    // `lts/-1` runner specifically, three runs in a row, needing 17s+ while
    // passing locally in under 7s every time. 30s gives real margin without
    // hiding a genuine hang (which would still time out, just later).
    testTimeout: 30_000,
  },
})
