/**
 * The document types this plugin ever writes for an editor's own state.
 *
 * Do **not** add `structureInbox.assignment` (`ASSIGNMENT_TYPE` in
 * `src/inbox/sources/assignmentStore.ts`) here, even though it's grouped
 * with these in `AGENTS.md` as another "per-editor-store-shaped, never
 * registered" type — its own `_id` suffix is a hash of the *target* id
 * (`assignmentDocId`), not a user id, so `findStaleEditorDocuments`' own
 * `${_type}.${userId}` assumption (see its doc comment below) does not
 * hold for it. Adding it here would make every real, live assignment
 * document look orphaned (its id suffix will never match a real user id),
 * and the README's own documented cleanup recipe shows deleting exactly
 * the ids this function returns.
 *
 * @public
 */
export const EDITOR_DOC_TYPES = [
  'structureInbox.dismissals',
  'structureInbox.snoozes',
  'structureInbox.todos',
  'structureInbox.assessments',
] as const

/**
 * One of this plugin's own per-editor documents, as returned by a GROQ query.
 *
 * @public
 */
export interface EditorDocRef {
  _id: string
  _type: string
}

/**
 * Which of this plugin's own per-editor documents belong to a user id not in
 * `activeUserIds`.
 *
 * A document's own id is `${_type}.${sanitizedUserId}` (see
 * `dismissalsDocumentId`/`snoozesDocumentId`/`todosDocumentId` in
 * `src/store/`) — stripping the `${_type}.` prefix recovers the original user
 * id exactly, for every real Sanity user id, since the sanitization those
 * functions apply is a no-op on the character set Sanity actually uses (see
 * `plans/README.md`'s "Lossy user-id → document-id mapping" entry).
 *
 * Pure — this function does no fetching of either list. The caller supplies
 * both: the documents via `*[_type in $types]` naming `EDITOR_DOC_TYPES`, and
 * the active user ids via `useUserListWithPermissions` or Sanity's project
 * members API — whichever fits their own Studio's setup. This function only
 * decides which documents are now orphaned; deleting them, and on what
 * schedule, is the caller's own decision, the same way `buildDigest` leaves
 * "fetch" and "send" to its caller.
 *
 * @public
 */
export function findStaleEditorDocuments(
  docs: readonly EditorDocRef[],
  activeUserIds: readonly string[],
): string[] {
  const active = new Set(activeUserIds)

  return docs
    .filter((doc) => {
      const userId = doc._id.slice(doc._type.length + 1)
      return userId.length > 0 && !active.has(userId)
    })
    .map((doc) => doc._id)
}
