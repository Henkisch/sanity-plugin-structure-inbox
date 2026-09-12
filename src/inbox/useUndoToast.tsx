import {Button} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {useCallback} from 'react'
import {useTranslation} from 'sanity'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

/** How long a row fades out before the action it's leaving for actually runs — see `useUndoToast`. */
export const EXIT_ANIMATION_MS = 180

/**
 * A brief, cancellable window after a bulk "mark done" or "snooze" — the two
 * actions that move rows out of Open without anyone explicitly asking to
 * delete anything, so an accidental multi-select-and-confirm shouldn't need a
 * trip to find each row again.
 *
 * `onUndo` only re-runs this pane's own local restore/wake — it can't reverse
 * a source's own `resolve` (a Task actually completed elsewhere, say), so the
 * toast's promise is scoped to "back in your Open list," same as everywhere
 * else `resolve` and `dismiss` are already two separate ideas.
 */
export function useUndoToast() {
  const toast = useToast()
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)

  return useCallback(
    (options: {title: string; onUndo: () => void}) => {
      // Toast APIs don't have an obvious cross-implementation way to re-close
      // themselves early; the alternative (a self-owned toast log) does. This
      // way of picking one is why undoing still updates the same toast rather
      // than stacking a second one.
      const id = `structure-inbox-undo-${Date.now()}-${Math.random().toString(36).slice(2)}`

      const handleUndo = () => {
        options.onUndo()
        toast.push({id, status: 'success', title: t('undo.done'), duration: 1500})
      }

      toast.push({
        id,
        status: 'success',
        title: options.title,
        duration: 6000,
        description: (
          <Button
            fontSize={1}
            mode="bleed"
            onClick={handleUndo}
            padding={0}
            text={t('selection.undo')}
          />
        ),
      })
    },
    [toast, t],
  )
}
