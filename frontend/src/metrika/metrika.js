/* ════════════════════════════════════════════════════════════════════════
   Яндекс Метрика. Правила (не ослаблять без решения владельца сайта):

   1. ID — только из VITE_YM_ID (frontend/.env.local, бакается в сборку).
      Пусто или не число → нет ни счётчика, ни баннера (METRIKA_ENABLED).
   2. Счётчик грузится ТОЛЬКО после «Принять» в баннере (152-ФЗ: cookie и
      данные посетителя уходят в Метрику лишь с согласия). Выбор хранится в
      localStorage; «Отклонить» → счётчика нет.
   3. Вебвизор — только на публичных страницах (/, /privacy, /consent, /terms —
      isPublicPath).
      Он пишет содержимое страницы, а в /app, /history, /profile, /reports —
      замеры и фото клиентов, в /login и /register — формы. Параметр webvisor
      задаётся один раз при init, выключить его на ходу нельзя, поэтому
      сессия, начатая с Вебвизором, уходит на непубличный адрес ПОЛНОЙ
      загрузкой страницы — там счётчик поднимается уже без Вебвизора
      (guardPrivateNavigation + страховка в MetrikaTracker).
   4. Поля ввода маскируются везде: класс ym-disable-keys на каждом input и
      textarea — «Отключение записи данных, вводимых в поля» (документация
      Метрики, «Настройка сбора данных»). Ставится до загрузки счётчика и
      на всё, что появится позже (MutationObserver).
   5. Загрузчик — стандартный из документации («Подключение кода счетчика с
      помощью внешнего скрипта»), без inline-скрипта: CSP script-src 'self'.
      Домены Метрики в CSP — frontend/nginx.conf.
   6. SPA: init с defer:true (сам счётчик просмотров не шлёт), просмотр —
      hit() на каждую смену роута, включая первую (MetrikaTracker.jsx).
   Service worker запросы к mc.yandex.ru не трогает: у него есть маршруты
   только для прекэша своего домена и для навигации.
   ════════════════════════════════════════════════════════════════════════ */
import { isPublicPath } from '../seo/routes'

const RAW_ID = String(import.meta.env.VITE_YM_ID ?? '').trim()
export const METRIKA_ENABLED = /^\d+$/.test(RAW_ID)
const ID = METRIKA_ENABLED ? Number(RAW_ID) : 0

const CONSENT_KEY = 'kb-cookie-consent'   // 'accepted' | 'declined'

export function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}
export function saveConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value) } catch {}
}

// Отзыв/пересмотр согласия на cookie (ссылка «Настройки cookie» в подвалах,
// metrika/CookieSettingsLink.jsx). Забываем выбор, стираем cookie Метрики и
// перезагружаем страницу: уже загруженный счётчик выключить на ходу нельзя,
// а после перезагрузки он не поднимется, пока в баннере снова не нажмут
// «Принять». Cookie Метрика ставит на домен сайта и на родительский
// (.gottland.ru) — чистим оба варианта.
export function resetConsent() {
  try { localStorage.removeItem(CONSENT_KEY) } catch {}
  try {
    const host = location.hostname
    const parent = host.split('.').slice(-2).join('.')
    for (const pair of document.cookie.split(';')) {
      const name = pair.split('=')[0].trim()
      if (!/^(_ym|yandexuid|yuidss|ymex|mdd$)/.test(name)) continue
      for (const domain of ['', `; domain=${host}`, `; domain=.${host}`, `; domain=.${parent}`]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`
      }
    }
  } catch {}
  location.reload()
}

let started = false
let webvisorOn = false
export const isWebvisorSession = () => webvisorOn

function maskInputs() {
  const mark = (root) => {
    if (root.matches?.('input, textarea')) root.classList.add('ym-disable-keys')
    root.querySelectorAll?.('input, textarea').forEach((el) => el.classList.add('ym-disable-keys'))
  }
  mark(document.body)
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) mark(n)
  }).observe(document.body, { childList: true, subtree: true })
}

// Клик по ссылке на непубличный адрес во время сессии с Вебвизором →
// полная загрузка вместо перехода React Router. Слушатель на document в фазе
// перехвата срабатывает раньше React (тот слушает на #root).
function guardPrivateNavigation() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target.closest?.('a[href]')
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const url = new URL(a.href, location.href)
    if (url.origin !== location.origin || isPublicPath(url.pathname)) return
    e.preventDefault()
    e.stopPropagation()
    location.assign(url.href)
  }, true)
}

export function startMetrika(pathname) {
  if (!METRIKA_ENABLED || started) return
  started = true
  webvisorOn = isPublicPath(pathname)
  maskInputs()
  if (webvisorOn) guardPrivateNavigation()

  // Загрузчик из кода вставки, который выдаёт интерфейс Метрики (2026-09),
  // только без inline-<script>. tag.js?id=… + ssr:true — файл счётчика
  // собирается на сервере Метрики по настройкам счётчика (документация,
  // «Установка нескольких счетчиков»: при выключенном в настройках Вебвизоре
  // модуля Вебвизора в файле нет). ecommerce:"dataLayer" из того кода не
  // берём — магазина на сайте нет. <noscript>-пиксель тоже: он шлёт просмотр
  // без JS, то есть без согласия.
  const w = window
  w.ym = w.ym || function ym() { (w.ym.a = w.ym.a || []).push(arguments) }
  w.ym.l = Date.now()
  const s = document.createElement('script')
  s.async = true
  s.src = `https://mc.yandex.ru/metrika/tag.js?id=${ID}`
  document.head.appendChild(s)

  w.ym(ID, 'init', {
    ssr: true,
    defer: true,               // SPA: просмотры шлём сами (hit) — см. MetrikaTracker
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: webvisorOn,      // false на непубличных — см. п.3 в шапке
  })
}

export function hit(url, { title, referer } = {}) {
  if (!started) return
  window.ym(ID, 'hit', url, { title, referer })
}
