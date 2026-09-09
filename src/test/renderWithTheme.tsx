import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {render} from '@testing-library/react'
import {type ReactElement} from 'react'
import {route, RouterProvider} from 'sanity/router'

const theme = buildTheme()
const router = route.create('/')

/**
 * Wraps a component with what Sanity UI and `sanity/router` need to render at
 * all: a theme, and a router context for `useRouter()` (`InboxRow` calls it
 * unconditionally to build its "Open" link, even for rows with no intent).
 * Navigation itself is never exercised by these tests, so `onNavigate` is a
 * no-op and `state` is empty.
 */
export function renderWithTheme(ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <RouterProvider onNavigate={() => {}} router={router} state={{}}>
        {ui}
      </RouterProvider>
    </ThemeProvider>,
  )
}
