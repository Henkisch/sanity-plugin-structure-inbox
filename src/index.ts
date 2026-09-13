export {DEFAULT_TOOL_NAME, INBOX_PANE_ID, STRUCTURE_INBOX_NAMESPACE} from './constants'
export {structureInbox} from './plugin'
export {inboxListItem} from './structure/inboxNode'
export type {StructureInboxConfig} from './types'

export type {InboxItem, InboxSource, InboxSourceResult} from './inbox/types'
export {openTasks, type OpenTasksOptions} from './inbox/sources/openTasks'
export {todos, type TodosOptions} from './inbox/sources/todos'
export {unpublishedDrafts, type UnpublishedDraftsOptions} from './inbox/sources/unpublishedDrafts'
export {upcomingReleases, type UpcomingReleasesOptions} from './inbox/sources/upcomingReleases'

export {SectionCard} from './ui/SectionCard'

// Pure, dependency-free reads of the plugin's own per-editor documents — no
// React, no Studio context. Exported for code that reads these documents
// outside a Studio, such as a Sanity Function building a digest with
// `buildDigest`, or finding a departed editor's leftover documents with
// `findStaleEditorDocuments` — see "Recipe: a digest outside the Studio" and
// "Recipe: cleaning up after a departed editor" in the README.
export {isDismissed, parseDismissals, type DismissalState} from './store/dismissals'
export {isSnoozed, parseSnoozes, type SnoozeState} from './store/snoozes'
export {parseTodos, type TodoItem, type TodosState} from './store/todos'
export {buildDigest, type DigestEditor, type DigestSource, type EditorDigest} from './digest'
export {
  EDITOR_DOC_TYPES,
  findStaleEditorDocuments,
  type EditorDocRef,
} from './staleEditorDocs'
