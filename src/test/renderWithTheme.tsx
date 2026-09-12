import {ThemeProvider} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {ToastProvider} from '@sanity/ui/toast'
import {render} from '@testing-library/react'
import {type ReactElement} from 'react'
import {route, RouterProvider} from 'sanity/router'

const theme = buildTheme()
const router = route.create('/')

/**
 * Wraps a component with what Sanity UI and `sanity/router` need to render at
 * all: a theme, a router context for `useRouter()` (`InboxRow` calls it
 * unconditionally to build its "Open" link, even for rows with no intent),
 * and a toast context for `useToast()` (`useUndoToast` calls it to offer
 * undo after a bulk mark-done or snooze). Navigation itself is never
 * exercised by these tests, so `onNavigate` is a no-op and `state` is empty.
 */
export function renderWithTheme(ui: ReactElement) {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <RouterProvider onNavigate={() => {}} router={router} state={{}}>
          {ui}
        </RouterProvider>
      </ToastProvider>
    </ThemeProvider>,
  )
}
