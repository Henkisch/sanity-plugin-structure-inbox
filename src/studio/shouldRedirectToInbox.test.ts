import {describe, expect, it} from 'vitest'

import {type RedirectDecision, shouldRedirectToInbox} from './shouldRedirectToInbox'

/** A landing that should redirect. Each test spoils exactly one thing about it. */
const landing: RedirectDecision = {
  redirectOnLanding: true,
  homeAvailable: true,
  activeToolName: 'structure',
  targetToolName: 'structure',
  panes: [],
  intent: undefined,
}

describe('shouldRedirectToInbox', () => {
  it('redirects on a bare landing', () => {
    expect(shouldRedirectToInbox(landing)).toBe(true)
  })

  it('stays put when the editor turned the redirect off', () => {
    expect(shouldRedirectToInbox({...landing, redirectOnLanding: false})).toBe(false)
  })

  it('stays put when the Inbox pane could not be injected', () => {
    // Redirecting here would send the editor to a URL that resolves to nothing.
    expect(shouldRedirectToInbox({...landing, homeAvailable: false})).toBe(false)
  })

  it('ignores tools this plugin is not attached to', () => {
    expect(shouldRedirectToInbox({...landing, activeToolName: 'vision'})).toBe(false)
  })

  it('leaves a deep link alone', () => {
    const panes = [[{id: 'post'}], [{id: 'abc123'}]]
    expect(shouldRedirectToInbox({...landing, panes})).toBe(false)
  })

  it('leaves a single already-open pane alone', () => {
    expect(shouldRedirectToInbox({...landing, panes: [[{id: 'post'}]]})).toBe(false)
  })

  it('yields to an intent that is still resolving', () => {
    // `IntentResolver` is about to navigate. Redirecting now would win the race
    // and drop the document the editor asked for.
    expect(shouldRedirectToInbox({...landing, intent: 'edit'})).toBe(false)
  })

  it('treats a missing panes value as a bare landing', () => {
    // The scoped router omits `panes` entirely at `/structure`.
    expect(shouldRedirectToInbox({...landing, panes: undefined})).toBe(true)
  })
})
