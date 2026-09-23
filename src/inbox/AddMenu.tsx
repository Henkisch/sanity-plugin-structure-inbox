import {AddIcon} from '@sanity/icons/Add'
import {isDocumentSchemaType} from '@sanity/types'
import {Button} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {useMemo} from 'react'
import {useSchema, useTranslation} from 'sanity'
import {useRouter} from 'sanity/router'

import {STRUCTURE_INBOX_NAMESPACE} from '../constants'

/**
 * Document types this plugin never lists as a "new content" option, even
 * though they are real, `isDocumentSchemaType`-passing document types.
 * Sanity's own system/media-library types (and the odd deprecated
 * `sanity.previewUrlSecret`-style singleton) live in every schema whether a
 * developer registered them or not — surfacing them next to a project's own
 * content types would bury the ones an editor actually wants under ones
 * nobody ever "adds" by hand. Best-effort prefix match, not an exhaustive
 * enumeration: a real, named document type a developer defines is vanishingly
 * unlikely to start with any of these.
 *
 * Exported: `contentGapsDigest.ts` reuses this same "real project content
 * type" filter for its own schema-wide survey, rather than redefining it.
 */
export const HIDDEN_TYPE_PREFIXES = ['sanity.', 'system.', 'media.']

/**
 * Plugin-owned bookkeeping types that a Studio registers as real document
 * types, so the prefix list above can't catch them. `translation.metadata` is
 * `@sanity/document-internationalization`'s link between a document's
 * translations — one per translated document, never something an editor
 * creates, drafts, or needs to hear about. Matched exactly: `translation.` is
 * too generic a prefix to claim.
 */
export const HIDDEN_TYPE_NAMES: ReadonlySet<string> = new Set(['translation.metadata'])

export function isHiddenType(name: string): boolean {
  return HIDDEN_TYPE_NAMES.has(name) || HIDDEN_TYPE_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/**
 * "Add content" — any document type this project has, via Studio's own
 * create flow. Used to also offer per-source creators (`todos`, say) behind
 * this same trigger, merged in to keep two buttons from crowding the tab row
 * (see git history) — split back out once the toolbar itself moved off that
 * row: a creator source now gets its own control right in the main column's
 * toolbar (`Inbox.tsx`'s `mainColumnActions`), next to Suggest todos, since
 * it only ever affects the editor's own queue. This stays the global,
 * source-agnostic one, back in its original spot beside the tabs.
 *
 * Still deliberately does not reimplement document creation: picking a type
 * here only calls `navigateIntent('create', {type})`, the same router intent
 * `InboxRow.tsx` already uses for `'edit'` — Sanity's own create flow takes
 * over from there exactly as it would from the built-in "+" menu.
 */
export function AddMenu() {
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const schema = useSchema()
  const {navigateIntent} = useRouter()

  const documentTypes = useMemo(() => {
    return schema
      .getTypeNames()
      .filter((name) => !isHiddenType(name))
      .map((name) => schema.get(name))
      .filter((type) => type !== undefined && isDocumentSchemaType(type))
      .map((type) => ({name: type.name, title: type.title || type.name, icon: type.icon}))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [schema])

  if (documentTypes.length === 0) return null

  return (
    <MenuButton
      button={
        <Button
          fontSize={1}
          icon={AddIcon}
          mode="ghost"
          text={t('inbox.addContent')}
          tone="primary"
        />
      }
      id="structure-inbox-add-menu"
      menu={
        <Menu>
          {documentTypes.map((type) => (
            <MenuItem
              icon={type.icon || AddIcon}
              key={type.name}
              onClick={() => navigateIntent('create', {type: type.name})}
              text={type.title}
            />
          ))}
        </Menu>
      }
      popover={{placement: 'bottom-end', portal: true}}
    />
  )
}
