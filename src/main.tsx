import './startupErrors'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { installLongPress } from './longPress'

// On a touch screen, press and hold opens the menus a right-click opens with a mouse (see longPress.ts).
if ('ontouchstart' in window) installLongPress()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
