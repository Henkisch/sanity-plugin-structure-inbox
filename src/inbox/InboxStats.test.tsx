import {cleanup, fireEvent, screen} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {renderWithTheme} from '../test/renderWithTheme'
import {countClearedToday, countUnassigned, groupByAssigneeLoad, InboxStats} from './InboxStats'
import {type MergedRow} from './mergeItems'
import {type InboxItem} from './types'

afterEach(cleanup)

function item(id: string, extra: Partial<InboxItem> = {}): InboxItem {
  return {id, title: `Item ${id}`, ...extra}
}

function row(
  sourceName: string,
  itemProps: Partial<InboxItem> & {id: string},
  rowProps: Partial<Pick<MergedRow, 'clearedAt' | 'clearedBy'>> = {},
): MergedRow {
  return {
    key: `${sourceName} ${itemProps.id}`,
    sourceName,
    item: item(itemProps.id, itemProps),
    ...rowProps,
  }
}

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('countUnassigned', () => {
  it('counts only rows with nobody on them', () => {
    const rows = [
      row('tasks', {id: '1'}),
      row('tasks', {id: '2', assignee: {id: 'ada', label: 'Ada'}}),
      row('tasks', {id: '3'}),
    ]
    expect(countUnassigned(rows)).toBe(2)
  })
})

describe('groupByAssigneeLoad', () => {
  it('groups and counts by assignee, busiest first', () => {
    const rows = [
      row('tasks', {id: '1', assignee: {id: 'ada', label: 'Ada'}}),
      row('tasks', {id: '2', assignee: {id: 'bea', label: 'Bea'}}),
      row('tasks', {id: '3', assignee: {id: 'ada', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([
      {id: 'ada', label: 'Ada', imageUrl: undefined, count: 2},
      {id: 'bea', label: 'Bea', imageUrl: undefined, count: 1},
    ])
  })

  it('does not merge two different people who happen to share a display name', () => {
    const rows = [
      row('tasks', {id: '1', assignee: {id: 'ada-1', label: 'Ada'}}),
      row('tasks', {id: '2', assignee: {id: 'ada-2', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([
      {id: 'ada-1', label: 'Ada', imageUrl: undefined, count: 1},
      {id: 'ada-2', label: 'Ada', imageUrl: undefined, count: 1},
    ])
  })

  it('excludes unassigned rows entirely', () => {
    const rows = [
      row('tasks', {id: '1'}),
      row('tasks', {id: '2', assignee: {id: 'ada', label: 'Ada'}}),
    ]
    expect(groupByAssigneeLoad(rows)).toEqual([{id: 'ada', label: 'Ada', imageUrl: undefined, count: 1}])
  })
})

describe('countClearedToday', () => {
  it('counts only rows whose clearedAt falls on the same local day as now', () => {
    const rows = [
      row('drafts', {id: '1'}, {clearedAt: new Date(NOW).toISOString()}),
      row('drafts', {id: '2'}, {clearedAt: new Date(NOW - 2 * DAY).toISOString()}),
      row('tasks', {id: '3'}, {clearedAt: new Date(NOW).toISOString()}),
    ]
    expect(countClearedToday(rows, NOW)).toBe(2)
  })

  it('counts a manual clear on the day it was actually cleared, not the day its content last changed', () => {
    const rows = [
      row(
        'drafts',
        {id: '1', changedAt: new Date(NOW - 30 * DAY).toISOString()},
        {clearedAt: new Date(NOW).toISOString(), clearedBy: 'editor'},
      ),
    ]
    expect(countClearedToday(rows, NOW)).toBe(1)
  })

  it('returns 0 for a row with no clearedAt rather than throwing', () => {
    expect(countClearedToday([row('drafts', {id: '1'})], NOW)).toBe(0)
  })
})

vi.mock('sanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sanity')>()
  return {...actual, useTranslation: () => ({t: (key: string) => key})}
})

describe('InboxStats', () => {
  it('renders the unassigned count and cleared-today count', () => {
    const rows = [
      row('tasks', {id: '1', timestamp: new Date(NOW).toISOString()}),
      row('tasks', {id: '2', assignee: {id: 'ada', label: 'Ada'}}),
    ]

    renderWithTheme(<InboxStats assignableRows={rows} clearedRows={[]} openRows={rows} />)

    expect(screen.getByText('stats.title')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
  })

  it('shows an unassigned row in the per-assignee section, not a separate stat of its own', () => {
    const rows = [row('tasks', {id: '1'})]

    renderWithTheme(<InboxStats assignableRows={rows} clearedRows={[]} openRows={rows} />)

    expect(screen.getByText('stats.load.title')).toBeTruthy()
    expect(screen.getByText('assignee.unassigned')).toBeTruthy()
  })

  it('omits the per-assignee section entirely when there is nothing assignable at all', () => {
    renderWithTheme(<InboxStats assignableRows={[]} clearedRows={[]} openRows={[]} />)

    expect(screen.queryByText('stats.load.title')).toBeNull()
  })

  it('omits the AI-suggested-todos trigger entirely with no onSuggestTodos (no todos source configured)', () => {
    renderWithTheme(<InboxStats assignableRows={[]} clearedRows={[]} openRows={[]} />)

    expect(screen.queryByText('overview.askAi')).toBeNull()
  })

  it('shows the trigger while idle, and calls onSuggestTodos on click', () => {
    const onSuggestTodos = vi.fn()
    renderWithTheme(
      <InboxStats
        assignableRows={[]}
        clearedRows={[]}
        onSuggestTodos={onSuggestTodos}
        openRows={[]}
        suggestions={{status: 'idle'}}
      />,
    )

    expect(screen.getByText('overview.askAi')).toBeTruthy()
    fireEvent.click(screen.getByText('overview.askAi'))
    expect(onSuggestTodos).toHaveBeenCalledTimes(1)
  })

  it('hides the trigger once a suggestion list has come back, showing the suggestions instead', () => {
    renderWithTheme(
      <InboxStats
        assignableRows={[]}
        clearedRows={[]}
        onSuggestTodos={vi.fn()}
        openRows={[]}
        suggestions={{status: 'done', items: [{title: 'Write a hero image brief', reason: 'Three posts are missing one.'}]}}
      />,
    )

    expect(screen.queryByText('overview.askAi')).toBeNull()
    expect(screen.getByText('Write a hero image brief')).toBeTruthy()
    expect(screen.getByText('Three posts are missing one.')).toBeTruthy()
  })

  it('says so when nothing looks worth a new todo, rather than showing an empty list', () => {
    renderWithTheme(
      <InboxStats
        assignableRows={[]}
        clearedRows={[]}
        onSuggestTodos={vi.fn()}
        openRows={[]}
        suggestions={{status: 'done', items: []}}
      />,
    )

    expect(screen.getByText('todoSuggest.none')).toBeTruthy()
  })

  it('adds a suggestion by its own index, and dismisses another without touching it', () => {
    const onAddSuggestion = vi.fn()
    const onDismissSuggestion = vi.fn()

    renderWithTheme(
      <InboxStats
        assignableRows={[]}
        clearedRows={[]}
        onAddSuggestion={onAddSuggestion}
        onDismissSuggestion={onDismissSuggestion}
        onSuggestTodos={vi.fn()}
        openRows={[]}
        suggestions={{
          status: 'done',
          items: [
            {title: 'First suggestion', reason: 'Reason one.'},
            {title: 'Second suggestion', reason: 'Reason two.'},
          ],
        }}
      />,
    )

    const addButtons = screen.getAllByText('todoSuggest.add')
    fireEvent.click(addButtons[1])
    expect(onAddSuggestion).toHaveBeenCalledWith(1)

    const dismissButtons = screen.getAllByText('todoSuggest.dismiss')
    fireEvent.click(dismissButtons[0])
    expect(onDismissSuggestion).toHaveBeenCalledWith(0)
  })
})
