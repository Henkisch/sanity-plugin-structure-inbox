import {describe, expect, it} from 'vitest'

import {taskDetailHref} from './openTaskDetail'

describe('taskDetailHref', () => {
  // The same params Sanity's own "Copy link to task" writes; its Tasks layout
  // reads them on load to open the task.
  it('is a query-only URL that opens the task panel on this task', () => {
    const params = new URLSearchParams(taskDetailHref('task-1').slice(1))
    expect(taskDetailHref('task-1').startsWith('?')).toBe(true)
    expect(params.get('sidebar')).toBe('tasks')
    expect(params.get('viewMode')).toBe('edit')
    expect(params.get('selectedTask')).toBe('task-1')
  })

  it('encodes an id with URL-significant characters', () => {
    const params = new URLSearchParams(taskDetailHref('a&b=c').slice(1))
    expect(params.get('selectedTask')).toBe('a&b=c')
  })
})
