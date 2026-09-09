import {Box, Card, Container, Grid, Stack, Text} from '@sanity/ui'
import {useTranslation} from 'sanity'

import {STRUCTURE_HOME_NAMESPACE} from '../constants'
import {type StructureHomeWidget} from '../types'
import {columnSpanFor, GRID_COLUMNS} from '../ui/columnSpan'
import {WidgetCard} from '../ui/WidgetCard'

/**
 * Props the structure tool hands a `S.component()` pane. Only `options` matters
 * here — the rest (pane keys, selection state, split-view indexes) is chrome the
 * pane itself already handles.
 */
interface HomePaneProps {
  options?: {widgets?: StructureHomeWidget[]}
}

/**
 * The pane that fills the canvas editors land on.
 *
 * `UserComponentPaneContent` already gives us `overflow: auto` and full height,
 * so this only has to lay widgets out.
 */
export function HomePane(props: HomePaneProps) {
  const widgets = props.options?.widgets ?? []
  const {t} = useTranslation(STRUCTURE_HOME_NAMESPACE)

  if (widgets.length === 0) {
    return (
      <Box padding={4}>
        <Container width={1}>
          <Card border padding={4} radius={3} tone="transparent">
            <Stack gap={3}>
              <Text size={1} weight="medium">
                {t('home.empty.title')}
              </Text>
              <Text muted size={1}>
                {t('home.empty.description')}
              </Text>
            </Stack>
          </Card>
        </Container>
      </Box>
    )
  }

  return (
    <Box padding={4}>
      <Container width={4}>
        <Grid gap={3} gridTemplateColumns={GRID_COLUMNS}>
          {widgets.map((widget) => {
            const Widget = widget.component
            return (
              <Box gridColumn={columnSpanFor(widget.layout?.width)} key={widget.name}>
                <WidgetCard icon={widget.icon} title={widget.title}>
                  <Widget name={widget.name} />
                </WidgetCard>
              </Box>
            )
          })}
        </Grid>
      </Container>
    </Box>
  )
}
