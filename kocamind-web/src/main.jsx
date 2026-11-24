import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalErrorTracking } from './lib/telemetry'

installGlobalErrorTracking()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <Analytics />
  </StrictMode>,
)

// HTML ile birlikte gelen koyu katmanı, uygulamanın ilk karesi boyandıktan sonra kaldır.
requestAnimationFrame(() => {
  requestAnimationFrame(() => document.getElementById('boot-screen')?.remove())
})
