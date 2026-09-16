import {author} from './documents/author'
import {event} from './documents/event'
import {post} from './documents/post'
import {siteSettings} from './documents/siteSettings'

export const schemaTypes = [post, author, event, siteSettings]

// Plan 026 spike only — the proposals-spike workspace's own document type,
// deliberately not in `schemaTypes` above: every other workspace shares that
// array, and this type has nothing to do with any of them. Was in the
// shared array once; showed up as a real, empty content-type entry in the
// `default` workspace's own left nav, which had nothing to do with it.
export {imageAltProposal} from './documents/imageAltProposal'
