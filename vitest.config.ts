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
    // rendering itself slower than local hardware. 15s gives that headroom
    // without hiding a real infinite-loop-style bug (a genuine hang would
    // still time out, just later).
    testTimeout: 15_000,
  },
})
