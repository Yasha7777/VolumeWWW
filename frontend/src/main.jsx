import './polyfills.js'                          // ← ПЕРВЫМ: global / process / Buffer
import { initQueue } from './queue/queue'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './swag.css'                              // ← тема свага (ПОСЛЕ styles.css)
import './report-panel.css'                      // ← стили выдвижного окна отчёта
import { ThemeProvider } from './theme/ThemeProvider'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)

// Очередь: слушатели сети/видимости, персистентное хранилище, первичный флаш.
initQueue()

// Service Worker — только прод-сборка (в dev SW выключен, чтобы не ломать /api-прокси).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            reg.waiting?.postMessage('kb-skip-waiting')   // новый SW → активировать сразу
          }
        })
      })
    }).catch(() => {})
  })
}
