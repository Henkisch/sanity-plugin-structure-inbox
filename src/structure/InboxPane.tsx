import {Inbox} from '../inbox/Inbox'
import {type InboxSource} from '../inbox/types'
import {type StructureInboxConfig} from '../types'

/**
 * Props the structure tool hands a `S.component()` pane. Only `options` matters
 * here — the rest (pane keys, selection state, split-view indexes) is chrome
 * the pane itself already handles.
 */
interface InboxPaneProps {
  options?: {
    sources?: InboxSource[]
    ask?: boolean
    summarize?: boolean
    suggestTodos?: boolean
    contentGaps?: StructureInboxConfig['contentGaps']
    context?: string
  }
}

/**
 * The pane that fills the canvas editors land on.
 *
 * `UserComponentPaneContent` already provides full height and scrolling, so
 * this only has to render the inbox.
 */
export function InboxPane(props: InboxPaneProps) {
  return (
    <Inbox
      ask={props.options?.ask ?? false}
      contentGaps={props.options?.contentGaps}
      context={props.options?.context}
      sources={props.options?.sources ?? []}
      summarize={props.options?.summarize ?? true}
      suggestTodos={props.options?.suggestTodos ?? true}
    />
  )
}
