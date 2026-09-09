import sanityPluginKitOxlint from '@sanity/plugin-kit/oxlint'
import {defineConfig} from 'oxlint'

export default defineConfig({
  extends: [sanityPluginKitOxlint],
  // `ignorePatterns` do not propagate through `extends`.
  ignorePatterns: [...(sanityPluginKitOxlint.ignorePatterns ?? [])],
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      rules: {
        // Tests deliberately reach past a builder's public surface — reading a
        // spec, calling an intent checker — to assert on what the plugin built.
        // In `src` a narrowing assertion is a smell; here it is the assertion.
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
  ],
})
