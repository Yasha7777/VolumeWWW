/* Service Worker — Volumetric Gottland PWA.
   injectManifest: workbox прекэширует оболочку (self.__WB_MANIFEST
   подставляется на сборке). /api/* НЕ кэшируем — приложение всегда идёт в сеть. */
import { precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// Берём управление страницей сразу после первой загрузки — без второго
// онлайн-reload. На iOS это критично: прогрев кеша там менее надёжен.
self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST || [])   // ← ОДИН раз (было продублировано — отсюда падала сборка)

// Навигацию SW НЕ перехватывает, пока приложение закрыто паролем (basic auth
// в nginx.conf). Раньше здесь был NavigationRoute → закешированная оболочка
// shell.html для /app, /login и т.д. С паролем это ломалось дважды: SW отдавал
// /app из кэша в обход пароля, а прекэш shell.html у посетителя лендинга
// получал 401 и валил установку SW целиком. Теперь роуты приложения всегда
// идут в сеть (nginx спросит пароль), публичные страницы по-прежнему отдаёт
// precacheAndRoute выше: / → index.html, /privacy → privacy.html, /consent,
// /terms (cleanURLs). Цена: /app не открывается без сети с нуля.
//
// Вернуть, когда пароль снимут (и убрать shell.html из globIgnores в
// vite.config.js):
//   import { NavigationRoute, registerRoute } from 'workbox-routing'
//   import { createHandlerBoundToURL } from 'workbox-precaching'
//   registerRoute(new NavigationRoute(createHandlerBoundToURL('/shell.html'), {
//     denylist: [/^\/api\//, /\/[^/?]+\.[^/]+$/],
//   }))

self.addEventListener('message', (e) => { if (e.data === 'kb-skip-waiting') self.skipWaiting() })

// ── Phase 2: Background Sync (Вариант A — будим страницу, сами не грузим) ────
// Воркер не отправляет фото сам (иначе морока с ротацией refresh-токена
// Supabase). Он будит открытую вкладку на флаш; если вкладок нет — шлёт
// подсказку открыть приложение.
self.addEventListener('sync', (event) => {
  if (event.tag === 'kb-flush-queue') event.waitUntil(flushViaClients())
})
async function flushViaClients() {
  const cls = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (cls.length) { for (const c of cls) c.postMessage('kb-flush'); return }
  try {
    await self.registration.showNotification('Volumetric Gottland', {
      body: 'Появилась связь — откройте приложение, чтобы отправить замеры из очереди.',
      icon: '/pwa-192.png', badge: '/pwa-192.png', tag: 'kb-flush-hint',
    })
  } catch {}
  throw new Error('no clients')   // reject → браузер повторит sync позже
}

// ── Phase 3 (заготовка): Web Push ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}; try { data = event.data?.json() ?? {} } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Volumetric Gottland', {
    body: data.body || 'Замер обработан.',
    icon: '/pwa-192.png', badge: '/pwa-192.png',
    data: { url: data.url || '/history' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/history'
  event.waitUntil((async () => {
    const cls = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of cls) if ('focus' in c) { c.navigate(url); return c.focus() }
    return self.clients.openWindow(url)
  })())
})
