import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startEngine, STATIC_MODE } from './lib/inbrowser'
import './index.css'

if (STATIC_MODE) startEngine()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
