import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/home.css'
import './styles/node.css'
import './styles/research.css'
import './styles/graph.css'
import './styles/custom.css'
import './styles/platform.css'
import App from './App.tsx'
import { SettingsWindow } from './Settings.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#settings' ? <SettingsWindow /> : <App />}
  </StrictMode>,
)
