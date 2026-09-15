import {type MergedRow} from '../inbox/mergeItems'

/**
 * The compact view of the list the model is shown.
 *
 * Deliberately not the whole `InboxItem`: a model choosing which rows match a
 * question needs what an editor reads to make the same decision — the title,
 * the context line, how long it has waited, which source and which document
 * type it is. Everything else (icons, intents, assignee image urls) is
 * plumbing, and every field included is a field that leaves the dataset.
 */
export interface DescribedRow {
  key: string
  source: string
  title: string
  subtitle?: string
  type?: string
  waitingSince?: string
  assignee?: string
}

export function describeRows(rows: readonly MergedRow[]): DescribedRow[] {
  return rows.map((row) => ({
    key: row.key,
    source: row.sourceName,
    title: row.item.title,
    subtitle: row.item.subtitle,
    type: row.item.intent?.params.type,
    waitingSince: row.item.timestamp,
    assignee: row.item.assignee?.label,
  }))
}

export interface AskInboxSelection {
  keys: string[]
  reason: string
}

/**
 * Turns a model answer into a selection, or nothing.
 *
 * Every returned key is checked against the rows actually on screen and
 * dropped if it is not one of them: a model will eventually invent a
 * plausible-looking key, and a selection referring to a row nobody can see is
 * worse than a short one. Duplicates collapse. An answer with no usable keys
 * is still a result — `{keys: [], reason}` — because "nothing here matches
 * that" is a true and useful answer, and rendering it as a failure would
 * teach editors the feature is unreliable.
 *
 * `null` means the answer was unparseable, which is a different thing and
 * gets a different message.
 */
export function selectionFromResponse(raw: unknown, rows: readonly MergedRow[]): AskInboxSelection | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (!('keys' in raw) || !Array.isArray(raw.keys)) return null

  const validKeys = new Set(rows.map((row) => row.key))
  const seen = new Set<string>()
  const keys: string[] = []

  for (const key of raw.keys) {
    if (typeof key !== 'string') continue
    if (!validKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }

  const reason = 'reason' in raw && typeof raw.reason === 'string' ? raw.reason : ''

  return {keys, reason}
}
