import {SparklesIcon} from '@sanity/icons/Sparkles'
import {Badge, Box, Button, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useMemo, useState} from 'react'
import {definePlugin, useClient} from 'sanity'
import {openTasks, unpublishedDrafts, type InboxItem} from 'sanity-plugin-structure-inbox'

/**
 * Plan 025 spike: does clustering the merged inbox list into shared
 * problems produce groups an editor would recognise, or generic buckets?
 *
 * Deliberately a throwaway prototype, not shipped surface — same posture as
 * `teamViewSpike.tsx` (plan 012): reads two already-exported sources
 * directly by calling their `useItems()` hook in a plain component, renders
 * no interactivity beyond a "Cluster" button, and duplicates a minimal
 * `describeRows`/`promptJson` locally rather than importing `src/ai/*` —
 * those are internal to the package's `src/`, not exported from
 * `sanity-plugin-structure-inbox`, so a spike living in `test-studio/` has
 * no way to reach them regardless of whether 019/022 have landed on `main`.
 * See `plans/mellow-weaving-cascade.md`'s "Findings — plan 025" for what
 * this proved and did not.
 */

interface Row {
  key: string
  sourceName: string
  item: InboxItem
}

interface Group {
  label: string
  why: string
  keys: string[]
}

interface ClusterResult {
  groups: Group[]
  ungrouped: string[]
}

function isClusterResult(value: unknown): value is ClusterResult {
  if (typeof value !== 'object' || value === null) return false
  const groups = (value as {groups?: unknown}).groups
  const ungrouped = (value as {ungrouped?: unknown}).ungrouped
  return Array.isArray(groups) && (ungrouped === undefined || Array.isArray(ungrouped))
}

/** Local stand-in for `src/ai/promptJson.ts` — see this file's own doc comment for why it's duplicated rather than imported. */
async function promptForGroups(
  client: ReturnType<typeof useClient>,
  rows: Row[],
): Promise<ClusterResult | null> {
  const described = rows.map((row) => ({
    key: row.key,
    source: row.sourceName,
    title: row.item.title,
    subtitle: row.item.subtitle,
  }))

  const raw = await client.withConfig({apiVersion: 'vX'}).agent.action.prompt({
    instruction:
      'Given this list of an editor\'s inbox items (JSON):\n$items\n---\n' +
      'Group items that share the same real, specific underlying problem or ' +
      'blocker (e.g. several items all blocked on the same missing asset, or ' +
      'all waiting on the same review) into named groups. Do not group items ' +
      'merely because they share a document type or topic area — that is ' +
      'not a shared problem. Leave anything without a genuine shared blocker ' +
      'out of every group, listed as ungrouped instead.\n' +
      'Answer with JSON only, no prose and no code fences, in this exact shape:\n' +
      '{"groups": [{"label": "<short, specific label naming the shared problem>", ' +
      '"why": "<one sentence, specific>", "keys": ["<row key>", ...]}], ' +
      '"ungrouped": ["<row key>", ...]}',
    instructionParams: {items: {type: 'constant', value: JSON.stringify(described)}},
  })

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed: unknown = JSON.parse(match[0])
    return isClusterResult(parsed) ? parsed : null
  } catch {
    return null
  }
}

function ClusterSpikeTool() {
  const client = useClient({apiVersion: '2025-02-19'})
  const draftsSource = useMemo(() => unpublishedDrafts({olderThanDays: 0, limit: 30}), [])
  const tasksSource = useMemo(() => openTasks({onlyMine: false}), [])

  const drafts = draftsSource.useItems()
  const tasks = tasksSource.useItems()

  const rows: Row[] = useMemo(
    () => [
      ...drafts.items.map((item): Row => ({key: `unpublishedDrafts ${item.id}`, sourceName: 'Draft', item})),
      ...tasks.items.map((item): Row => ({key: `openTasks ${item.id}`, sourceName: 'Task', item})),
    ],
    [drafts.items, tasks.items],
  )

  const [result, setResult] = useState<ClusterResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [requestCount, setRequestCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const runCluster = async () => {
    setBusy(true)
    setError(null)
    const started = Date.now()
    try {
      const clustered = await promptForGroups(client, rows)
      setResult(clustered)
      setRequestCount((n) => n + 1)
      if (!clustered) setError('Model answered, but not in the expected shape.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setElapsedMs(Date.now() - started)
      setBusy(false)
    }
  }

  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])
  // Keys the model invented, or duplicated across groups, are dropped here —
  // the same rule `askInbox.ts`'s `selectionFromResponse` applies, and for
  // the same reason: a group's rows must be exactly what an editor can see.
  const validGroups = useMemo(() => {
    if (!result) return []
    const seen = new Set<string>()
    return result.groups.map((group) => ({
      ...group,
      keys: group.keys.filter((key) => {
        if (seen.has(key) || !rowsByKey.has(key)) return false
        seen.add(key)
        return true
      }),
    }))
  }, [result, rowsByKey])

  const groupedKeys = useMemo(() => new Set(validGroups.flatMap((g) => g.keys)), [validGroups])
  const leftoverRows = rows.filter((row) => !groupedKeys.has(row.key))

  const loading = drafts.loading || tasks.loading

  return (
    <Box padding={4}>
      <Stack gap={4}>
        <Heading size={2}>Cluster spike</Heading>
        <Text size={1} muted>
          {rows.length} rows from `unpublishedDrafts` and `openTasks({'{'}onlyMine: false{'}'})`.
          Read-only prototype for Plan 025 — no selection, no actions, nothing here is ever applied
          to a real row.
        </Text>

        <Flex align="center" gap={3}>
          <Button
            disabled={busy || loading || rows.length === 0}
            icon={SparklesIcon}
            onClick={() => {
              runCluster().catch(() => undefined)
            }}
            text={busy ? 'Clustering…' : 'Cluster'}
            tone="primary"
          />
          {elapsedMs !== null && (
            <Text size={1} muted>
              {elapsedMs}ms · {requestCount} request{requestCount === 1 ? '' : 's'} this session
            </Text>
          )}
        </Flex>

        {error && (
          <Card padding={3} radius={2} tone="critical">
            <Text size={1}>{error}</Text>
          </Card>
        )}

        <Flex gap={4}>
          <Box flex={1}>
            <Stack gap={2}>
              <Text size={1} weight="semibold">
                Flat list ({rows.length})
              </Text>
              {rows.map((row) => (
                <Card key={row.key} padding={2} radius={2} tone="transparent">
                  <Flex justify="space-between">
                    <Text size={1}>{row.item.title}</Text>
                    <Badge fontSize={0} tone="default">
                      {row.sourceName}
                    </Badge>
                  </Flex>
                </Card>
              ))}
            </Stack>
          </Box>

          <Box flex={1}>
            <Stack gap={3}>
              <Text size={1} weight="semibold">
                Clustered {result ? `(${validGroups.length} groups)` : ''}
              </Text>
              {!result && <Text size={1} muted>Not clustered yet.</Text>}
              {validGroups.map((group) => (
                <Card key={group.label} padding={3} radius={2} shadow={1} tone="primary">
                  <Stack gap={2}>
                    <Text weight="semibold">
                      {group.label} ({group.keys.length})
                    </Text>
                    <Text size={1} muted>
                      {group.why}
                    </Text>
                    <Stack gap={1}>
                      {group.keys.map((key) => (
                        <Text key={key} size={1}>
                          {rowsByKey.get(key)?.item.title}
                        </Text>
                      ))}
                    </Stack>
                  </Stack>
                </Card>
              ))}
              {result && leftoverRows.length > 0 && (
                <Card padding={3} radius={2} tone="transparent">
                  <Stack gap={2}>
                    <Text weight="semibold">Ungrouped ({leftoverRows.length})</Text>
                    {leftoverRows.map((row) => (
                      <Text key={row.key} size={1}>
                        {row.item.title}
                      </Text>
                    ))}
                  </Stack>
                </Card>
              )}
            </Stack>
          </Box>
        </Flex>
      </Stack>
    </Box>
  )
}

export const clusterSpike = definePlugin({
  name: 'test-studio/cluster-spike',
  tools: (prev) => [
    ...prev,
    {
      name: 'clusterSpike',
      title: 'Cluster spike',
      icon: SparklesIcon,
      component: ClusterSpikeTool,
    },
  ],
})
