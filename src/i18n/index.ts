import {defineLocaleResourceBundle} from 'sanity'

import {STRUCTURE_HOME_NAMESPACE} from '../constants'
import enUS from './locales/en-US'

/**
 * The locale bundles this plugin registers.
 *
 * Studios add or override any locale by passing their own bundle with the
 * `structureHome` namespace to `i18n.bundles` in `sanity.config.ts`.
 *
 * @internal
 */
export const structureHomeLocaleBundles = [
  defineLocaleResourceBundle({
    locale: 'en-US',
    namespace: STRUCTURE_HOME_NAMESPACE,
    resources: enUS,
  }),
]
