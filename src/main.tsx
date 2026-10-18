import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SettingsWindow } from './Settings.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#settings' ? <SettingsWindow /> : <App />}
  </StrictMode>,
)
