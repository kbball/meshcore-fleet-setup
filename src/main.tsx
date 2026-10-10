import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans' // bundled, so the app stays fully offline
import './ui/theme.css'
import { App } from './ui/App'
import { applyTheme, storedTheme } from './ui/theme'

applyTheme(storedTheme()) // before first paint, so there is no flash of the wrong theme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App version={__APP_VERSION__} />
  </StrictMode>,
)
