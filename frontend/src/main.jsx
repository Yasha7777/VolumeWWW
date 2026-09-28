import './polyfills.js'                          // ← ПЕРВЫМ: global / process / Buffer
import { initQueue } from './queue/queue'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './theme-dark.css'                        // ← тёмная тема + переключатель (ПОСЛЕ styles.css)
import './theme-archive.css'                     // ← тема «Архив» (ПОСЛЕ styles.css и theme-dark.css)
import './report-panel.css'                      // ← стили выдвижного окна отчёта
import { ThemeProvider } from './theme/ThemeProvider'
import App, { PRERENDERED } from './App.jsx'

// Пререндер (scripts/vite-plugin-seo.js): публичные страницы приходят уже
// нарисованными, #root помечен data-page. Не гидрируем, а заменяем живым
// React: у клиента есть пользователь из кэша авторизации, у сборки — нет.
// Чтобы замена прошла в один кадр, чанк страницы догружаем ДО рендера
// (он уже летит по modulepreload из <head>). Не догрузился — рендерим как
// обычно, через Suspense.
const rootEl = document.getElementById('root')
const preload = PRERENDERED[rootEl.dataset.page]?.preload?.() ?? Promise.resolve()
preload.catch(() => {}).then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>
  )
})

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
