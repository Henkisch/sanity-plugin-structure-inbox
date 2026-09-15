import {type SanityClient} from '@sanity/client'

/**
 * Keeps only the ids this user has actually touched.
 *
 * Sanity has no "documents I edited" query: authorship lives in the transaction
 * log, not on the document, and the log's dataset-wide form returns nothing
 * without document ids. What it does support is a batch — many ids in the path
 * plus an `authors` filter — so one request can sift a page of candidates that
 * GROQ has already narrowed.
 *
 * That ordering matters: this never scans the dataset, it only asks "of these
 * ten, which are mine".
 */
export async function filterAuthoredBy(
  client: SanityClient,
  documentIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()

  const {dataset} = client.config()
  // No `tag` here: the client adds its own, and the API rejects a duplicate
  // with "tag can only occur once".
  const params = new URLSearchParams({excludeContent: 'true', authors: userId})

  const response = await client.request<string>({
    url: `/data/history/${dataset}/transactions/${documentIds.join(',')}?${params.toString()}`,
    // The endpoint answers with newline-delimited JSON, which the client would
    // otherwise try to parse as one document and reject.
    method: 'GET',
    headers: {Accept: 'application/x-ndjson'},
  })

  const authored = new Set<string>()

  for (const line of response.split('\n')) {
    if (!line.trim()) continue

    try {
      const transaction: unknown = JSON.parse(line)
      if (typeof transaction !== 'object' || transaction === null) continue
      if (!('documentIDs' in transaction)) continue

      const ids = transaction.documentIDs
      if (!Array.isArray(ids)) continue
      for (const id of ids) if (typeof id === 'string') authored.add(id)
    } catch {
      // A malformed line means one transaction is unreadable, not that the
      // whole answer is. Skipping it costs at most one document's authorship.
      continue
    }
  }

  return authored
}

/**
 * Who has touched each of these documents, most recent first.
 *
 * The same batched transaction-log request `filterAuthoredBy` makes, without
 * the `authors` filter — so it answers "who edited each of these ten" instead
 * of "which of these ten are mine". Same bound: it never scans the dataset,
 * it only asks about ids GROQ has already narrowed to.
 *
 * The endpoint returns lines oldest-first (confirmed empirically — see plan
 * 024's Findings), so each document's list is built in that order and
 * reversed at the end, then deduplicated keeping the first (most recent)
 * occurrence — an author who edited a document twice appears once, at their
 * latest position.
 */
export async function fetchDocumentAuthors(
  client: SanityClient,
  documentIds: string[],
): Promise<Map<string, string[]>> {
  const authorsByDoc = new Map<string, string[]>()
  if (documentIds.length === 0) return authorsByDoc

  const {dataset} = client.config()
  const params = new URLSearchParams({excludeContent: 'true'})

  const response = await client.request<string>({
    url: `/data/history/${dataset}/transactions/${documentIds.join(',')}?${params.toString()}`,
    method: 'GET',
    headers: {Accept: 'application/x-ndjson'},
  })

  for (const line of response.split('\n')) {
    if (!line.trim()) continue

    try {
      const transaction: unknown = JSON.parse(line)
      if (typeof transaction !== 'object' || transaction === null) continue
      if (!('documentIDs' in transaction) || !('author' in transaction)) continue

      const ids = transaction.documentIDs
      const author = transaction.author
      if (!Array.isArray(ids) || typeof author !== 'string') continue

      for (const id of ids) {
        if (typeof id !== 'string') continue
        const authors = authorsByDoc.get(id)
        if (authors) authors.push(author)
        else authorsByDoc.set(id, [author])
      }
    } catch {
      // Same contract as `filterAuthoredBy`: a malformed line costs one
      // transaction's worth of authorship, not the whole answer.
      continue
    }
  }

  for (const [id, authors] of authorsByDoc) {
    authorsByDoc.set(id, dedupeKeepingFirst(authors.reverse()))
  }

  return authorsByDoc
}

function dedupeKeepingFirst(authors: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const author of authors) {
    if (seen.has(author)) continue
    seen.add(author)
    deduped.push(author)
  }
  return deduped
}
