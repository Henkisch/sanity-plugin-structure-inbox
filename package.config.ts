import {defineConfig} from '@sanity/pkg-utils'

export default defineConfig({
  dist: 'dist',
  tsconfig: 'tsconfig.dist.json',

  tsdoc: {
    rules: {
      // `@internal`-tagged exports here (`SectionCard`, `suggestAltText`) are
      // pre-existing published symbols on a 2.x package — renaming either to
      // `_SectionCard`/`_suggestAltText` to satisfy this rule would itself be
      // the breaking change plan 067 exists to avoid making casually. Off,
      // not fixed: see plans/067.
      'ae-internal-missing-underscore': 'off',
    },
  },
})
