/**
 * Pure, dependency-free reads of the plugin's own per-editor documents, as a
 * separate entry point (`sanity-plugin-structure-inbox/node`) for code that
 * runs outside a Studio — a Sanity Function, a script, a cron job.
 *
 * Everything here is also exported from the main barrel, and always will be;
 * this is additive, not a migration. The difference is what comes *with* it.
 * The barrel necessarily pulls in `@sanity/client`'s type graph (26 of this
 * package's modules import it), and `@sanity/client` ships three ambient
 * `declare global` blocks. Two are inert. The third, `interface File {}`, is
 * not: in a consumer compiled **without** the DOM lib — which is every Node
 * program — it injects an empty global `File` where there was none, so
 * `const f: File = …` quietly compiles instead of being rejected, and any
 * error it does produce blames a type the consumer never declared. A Studio
 * never sees this, because a Studio always has the DOM lib.
 *
 * None of the modules re-exported below import `@sanity/client`, so this entry
 * point carries no ambient declarations at all — and none of the React or
 * Studio types a Node program has no use for either.
 *
 * ```ts
 * import {buildDigest, parseSnoozes} from 'sanity-plugin-structure-inbox/node'
 * ```
 */
export {parseAssessments, type AssessmentState, type CachedAssessment} from './store/assessments'
export {isDismissed, parseDismissals, type DismissalState} from './store/dismissals'
export {isSnoozed, parseSnoozes, type SnoozeState} from './store/snoozes'
export {parseTodos, type TodoItem, type TodosState} from './store/todos'
export {buildDigest, type DigestEditor, type DigestSource, type EditorDigest} from './digest'
export {EDITOR_DOC_TYPES, findStaleEditorDocuments, type EditorDocRef} from './staleEditorDocs'
