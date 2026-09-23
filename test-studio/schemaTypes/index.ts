import {author} from './documents/author'
import {cocktail} from './documents/cocktail'
import {event} from './documents/event'
import {guide} from './documents/guide'
import {post} from './documents/post'
import {siteSettings} from './documents/siteSettings'
import {imageWithAlt} from './objects/imageWithAlt'

const baseTypes = [post, author, event, siteSettings, imageWithAlt]

/**
 * Content i18n, field- and document-level, behind one toggle — the plugin has
 * to work with it on *and* with no i18n of any kind, and the only honest way
 * to test the second is a Studio that genuinely has none. Same pattern as
 * `SANITY_STUDIO_MEDIA_PLUGIN` in `sanity.config.ts`.
 *
 * Run without: `SANITY_STUDIO_NO_I18N=1 npm run dev`
 */
export const i18nEnabled = !process.env.SANITY_STUDIO_NO_I18N

export const schemaTypes = i18nEnabled ? [...baseTypes, cocktail, guide] : baseTypes
