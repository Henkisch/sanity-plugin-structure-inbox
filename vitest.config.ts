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
  },
})
