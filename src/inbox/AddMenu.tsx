import {AddIcon} from '@sanity/icons/Add'
import {isDocumentSchemaType} from '@sanity/types'
import {Button} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
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
 */
const HIDDEN_TYPE_PREFIXES = ['sanity.', 'system.', 'media.']

function isHiddenType(name: string): boolean {
  return HIDDEN_TYPE_PREFIXES.some((prefix) => name.startsWith(prefix))
}

interface AddMenuProps {
  /**
   * One entry per source that keeps its own items (today, only `todos`) —
   * clicking it opens that source's own `CreateItemRow` dialog, mounted
   * elsewhere with a hidden trigger; see `Inbox.tsx`.
   */
  creators: {key: string; label: string; onClick: () => void}[]
}

/**
 * One combined "+ Add" entry point, replacing what used to be two separate
 * buttons ("Add content" and "Add todo") sitting side by side on the tab row.
 * Two buttons plus the tabs themselves was too much to take in on a first
 * glance, especially at phone width, where it wrapped to a crowded second
 * line of its own — one small trigger with the same two choices one tap
 * further in reads as far less going on, without losing either action.
 *
 * Still deliberately does not reimplement document creation: picking a type
 * here only calls `navigateIntent('create', {type})`, the same router intent
 * `InboxRow.tsx` already uses for `'edit'` — Sanity's own create flow takes
 * over from there exactly as it would from the built-in "+" menu.
 */
export function AddMenu(props: AddMenuProps) {
  const {creators} = props
  const {t} = useTranslation(STRUCTURE_INBOX_NAMESPACE)
  const schema = useSchema()
  const {navigateIntent} = useRouter()

  const documentTypes = useMemo(() => {
    return schema
      .getTypeNames()
      .filter((name) => !isHiddenType(name))
      .map((name) => schema.get(name))
      .filter((type) => type !== undefined && isDocumentSchemaType(type))
      .map((type) => ({name: type.name, title: type.title || type.name}))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [schema])

  if (documentTypes.length === 0 && creators.length === 0) return null

  return (
    <MenuButton
      // `ghost` (a real border), not `bleed` (no border) like it used to
      // be — next to `Summarize`/`Scan for issues`'s own `ghost` buttons, a
      // borderless "+ Add" actually read as the *lightest*-weight of the
      // three, not the primary action it is: it's the one control here that
      // creates something new, not just reads an AI insight. `tone="primary"`
      // on top of that matching border is what actually nudges it up —
      // deliberately not `mode="default"` (a filled button), which would
      // read as dominant rather than "slightly more" next to two ghosts.
      button={
        <Button fontSize={1} icon={AddIcon} mode="ghost" padding={2} text={t('inbox.addMenu')} tone="primary" />
      }
      id="structure-inbox-add-menu"
      menu={
        <Menu>
          {creators.map((creator) => (
            <MenuItem icon={AddIcon} key={creator.key} onClick={creator.onClick} text={creator.label} />
          ))}
          {creators.length > 0 && documentTypes.length > 0 && <MenuDivider />}
          {documentTypes.map((type) => (
            <MenuItem
              icon={AddIcon}
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
