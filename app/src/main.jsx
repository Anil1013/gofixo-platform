import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { unlockAudio } from './utils/buzzer'

// Browsers block sound until the user has interacted with the page — unlock on the first tap/click
;['click', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
