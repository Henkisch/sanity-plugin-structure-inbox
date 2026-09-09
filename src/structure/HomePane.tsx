import {Inbox} from '../inbox/Inbox'
import {type InboxSource} from '../inbox/types'

/**
 * Props the structure tool hands a `S.component()` pane. Only `options` matters
 * here — the rest (pane keys, selection state, split-view indexes) is chrome
 * the pane itself already handles.
 */
interface HomePaneProps {
  options?: {sources?: InboxSource[]}
}

/**
 * The pane that fills the canvas editors land on.
 *
 * `UserComponentPaneContent` already provides full height and scrolling, so
 * this only has to render the inbox.
 */
export function HomePane(props: HomePaneProps) {
  return <Inbox sources={props.options?.sources ?? []} />
}
