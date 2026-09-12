import {describe, expect, it} from 'vitest'

import {EMPTY_TODOS, mergeTodos, parseTodos, withoutTodo, withTodo} from './todos'

describe('parseTodos', () => {
  it('reads back what it wrote', () => {
    const stored = withTodo(
      EMPTY_TODOS,
      {title: 'Write the launch email'},
      '2026-01-01T00:00:00.000Z',
    )

    expect(parseTodos(stored)).toEqual(stored)
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a future version', {version: 99, items: []}],
    ['a missing array', {version: 1}],
  ])('treats %s as no todos', (_label, value) => {
    expect(parseTodos(value)).toEqual(EMPTY_TODOS)
  })

  it('drops individual items that are the wrong shape', () => {
    const parsed = parseTodos({
      version: 1,
      items: [
        {id: '1', title: 'Good', createdAt: '2026-01-01T00:00:00.000Z'},
        {id: '2', title: 'Missing createdAt'},
        {id: '3', title: 'Bad description', createdAt: '2026-01-01T00:00:00.000Z', description: 42},
      ],
    })

    expect(parsed.items).toEqual([{id: '1', title: 'Good', createdAt: '2026-01-01T00:00:00.000Z'}])
  })

  it('keeps description and dueBy when present', () => {
    const stored = withTodo(EMPTY_TODOS, {
      title: 'Write the launch email',
      description: 'Mention the pricing change',
      dueBy: '2026-02-01',
    })

    expect(parseTodos(stored)).toEqual(stored)
  })
})

describe('withTodo', () => {
  it('appends a todo with a stable, unique id', () => {
    const state = withTodo(EMPTY_TODOS, {title: 'Write the launch email'})

    expect(state.items).toHaveLength(1)
    expect(state.items[0].title).toBe('Write the launch email')
    expect(state.items[0].id).toBeTruthy()
  })

  it('trims the title', () => {
    const state = withTodo(EMPTY_TODOS, {title: '  Write the launch email  '})

    expect(state.items[0].title).toBe('Write the launch email')
  })

  it('drops a blank title without adding anything', () => {
    expect(withTodo(EMPTY_TODOS, {title: '   '})).toEqual(EMPTY_TODOS)
  })

  it('stores a trimmed description and a due date when given', () => {
    const state = withTodo(EMPTY_TODOS, {
      title: 'Write the launch email',
      description: '  Mention the pricing change  ',
      dueBy: '2026-02-01',
    })

    expect(state.items[0].description).toBe('Mention the pricing change')
    expect(state.items[0].dueBy).toBe('2026-02-01')
  })

  it('omits description and dueBy rather than storing empty strings', () => {
    const state = withTodo(EMPTY_TODOS, {title: 'Only a title', description: '   ', dueBy: ''})

    expect(state.items[0].description).toBeUndefined()
    expect(state.items[0].dueBy).toBeUndefined()
  })
})

describe('withoutTodo', () => {
  it('removes the matching todo for good', () => {
    const state = withTodo(EMPTY_TODOS, {title: 'Only one'})
    const id = state.items[0].id

    expect(withoutTodo(state, id).items).toEqual([])
  })

  it('leaves other todos alone when removing one', () => {
    let state = withTodo(EMPTY_TODOS, {title: 'Keep me'})
    state = withTodo(state, {title: 'Remove me'})
    const idToRemove = state.items[1].id

    expect(withoutTodo(state, idToRemove).items.map((item) => item.title)).toEqual(['Keep me'])
  })

  it('is a no-op for an id that is not present', () => {
    const state = withTodo(EMPTY_TODOS, {title: 'Only one'})

    expect(withoutTodo(state, 'not-an-id')).toEqual(state)
  })
})

describe('mergeTodos', () => {
  it('unions two disjoint lists, ordered by creation time', () => {
    const a = withTodo(EMPTY_TODOS, {title: 'First'}, '2026-01-01T00:00:00.000Z')
    const b = withTodo(EMPTY_TODOS, {title: 'Second'}, '2026-01-02T00:00:00.000Z')

    expect(mergeTodos(a, b).items.map((item) => item.title)).toEqual(['First', 'Second'])
    expect(mergeTodos(b, a).items.map((item) => item.title)).toEqual(['First', 'Second'])
  })

  it('does not duplicate the same id present on both sides', () => {
    const a = withTodo(EMPTY_TODOS, {title: 'Only one'}, '2026-01-01T00:00:00.000Z')
    const b = {version: 1 as const, items: [...a.items]}

    expect(mergeTodos(a, b).items).toHaveLength(1)
  })

  it('returns the other side unchanged when merging with EMPTY_TODOS', () => {
    const state = withTodo(EMPTY_TODOS, {title: 'Only one'}, '2026-01-01T00:00:00.000Z')

    expect(mergeTodos(EMPTY_TODOS, state)).toEqual(state)
    expect(mergeTodos(state, EMPTY_TODOS)).toEqual(state)
  })
})
