import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// Azure ML's Jupyter proxy serves the app under /proxy/<port>/ rather than at the
// site root. Treat that prefix as the router root; everywhere else it is "/".
const proxyMatch = window.location.pathname.match(/^(\/proxy\/\d+)/)
const basename = proxyMatch ? proxyMatch[1] : '/'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
