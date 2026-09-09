import {defineLocaleResourceBundle} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'
import enUS from './locales/en-US'

/**
 * The locale bundles this plugin registers.
 *
 * Studios add or override any locale by passing their own bundle with the
 * `structureInbox` namespace to `i18n.bundles` in `sanity.config.ts`.
 *
 * @internal
 */
export const structureInboxLocaleBundles = [
  defineLocaleResourceBundle({
    locale: 'en-US',
    namespace: STRUCTURE_INBOX_NAMESPACE,
    resources: enUS,
  }),
]
