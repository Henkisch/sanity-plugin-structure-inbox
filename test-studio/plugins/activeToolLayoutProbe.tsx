import {Box, Card, Flex, Text} from '@sanity/ui'
import {type ActiveToolLayoutProps, definePlugin} from 'sanity'

/**
 * A second `activeToolLayout` override, so the Studio exercises the case where
 * this plugin is not the only one claiming that slot.
 *
 * `useMiddlewareComponents` composes overrides through `renderDefault`, and a
 * plugin that forgets to call it silently swallows every other plugin's
 * contribution. The banner below is here to make that failure visible: if it
 * disappears, something in the chain stopped delegating.
 */
export const activeToolLayoutProbe = definePlugin({
  name: 'test-studio/active-tool-layout-probe',
  studio: {
    components: {
      activeToolLayout: function ProbeActiveToolLayout(props: ActiveToolLayoutProps) {
        return (
          <Flex direction="column" height="fill">
            <Card padding={2} tone="primary">
              <Text size={0}>activeToolLayout probe — both overrides ran</Text>
            </Card>
            <Box flex={1} style={{minHeight: 0}}>
              {props.renderDefault(props)}
            </Box>
          </Flex>
        )
      },
    },
  },
})
