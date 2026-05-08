import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GorkBot from './GorkBot.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GorkBot />
  </StrictMode>,
)
