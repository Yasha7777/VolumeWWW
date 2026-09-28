import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import RouteMeta from './seo/RouteMeta'
import MetrikaTracker from './metrika/MetrikaTracker'
import { METRIKA_ENABLED } from './metrika/metrika'
// ── Login грузим статически: это входная точка и LCP-страница,
//    она должна отрисоваться из начального бандла без лишнего запроса ──
import Login from './pages/Login'

/* ── code splitting: каждая страница — отдельный чанк.
   Analyze утянет за собой PDF/3D-обёртки (сами движки — ещё глубже,
   через lazy в PlyViewer / RaschetDownloadButton / ReportPanel),
   а логин-страница останется лёгкой. Чанк качается при первом
   переходе на страницу и дальше сидит в кеше. ── */
/* Страница, которую можно загрузить ЗАРАНЕЕ. Нужна пререндеру: HTML
   лендинга/политики/404 уже нарисован сервером, и если первый рендер React
   упрётся в lazy(), он на кадр заменит готовую страницу заглушкой
   «Загрузка…». main.jsx зовёт preload() до createRoot — после этого
   страница рендерится сразу, без Suspense. */
function preloadable(factory) {
  let Loaded = null
  const Lazy = lazy(() => factory().then((m) => { Loaded = m.default; return m }))
  const Page = (props) => (Loaded ? <Loaded {...props} /> : <Lazy {...props} />)
  Page.preload = () => factory().then((m) => { Loaded = m.default })
  return Page
}

const Landing  = preloadable(() => import('./pages/Landing'))   // ← публичный лендинг ( / )
const Register = lazy(() => import('./pages/Register'))
const Analyze  = lazy(() => import('./pages/Analyze'))
const History  = lazy(() => import('./pages/History'))
const Profile  = lazy(() => import('./pages/Profile'))
const Reports  = lazy(() => import('./pages/Reports'))   // ← раздел «04 ОТЧЁТЫ»
const Privacy  = preloadable(() => import('./pages/Privacy'))
const NotFound = preloadable(() => import('./pages/NotFound'))

// data-page у #root (ставит пререндер) → какую страницу догрузить до рендера
export const PRERENDERED = { landing: Landing, privacy: Privacy, notfound: NotFound }

// Баннер согласия — отдельным чанком и только при заданном VITE_YM_ID:
// без счётчика ни его код, ни стили в сборку первого экрана не попадают.
const CookieBanner = METRIKA_ENABLED ? lazy(() => import('./metrika/CookieBanner')) : null

/* заглушка на время докачки чанка страницы (обычно доли секунды) */
const PageLoader = () => (
  <div style={{
    minHeight: '60vh', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    color: 'var(--muted, #888)', fontSize: 14,
  }}>
    Загрузка…
  </div>
)

// Корневой ErrorBoundary: ни один компонент не должен уметь погасить весь сайт
// в белый экран. Ловит и падение рендера (сцена лендинга при лежащем storage),
// и 404 ленивого чанка после деплоя в уже открытую вкладку.
function App() {
  return (
    <ErrorBoundary name="root">
    <AuthProvider>
      <BrowserRouter>
        {/* title / description / canonical / robots при переходах без перезагрузки */}
        <RouteMeta />
        {/* Яндекс Метрика: только при VITE_YM_ID и только после «Принять».
            Трекер — после RouteMeta (в hit уходит уже новый title). */}
        {METRIKA_ENABLED && (
          <>
            <MetrikaTracker />
            <Suspense fallback={null}><CookieBanner /></Suspense>
          </>
        )}
        {/* .app-shell — общая обёртка всех роутов. Переключатель тем — в шапке (Layout). */}
        <div className="app-shell">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Публичные */}
              <Route path="/"         element={<Landing />} />
              <Route path="/login"    element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/privacy"  element={<Privacy />} />

              {/* Приватные — приложение переехало с / на /app,
                  чтобы корень был публичным лендингом для любого гостя */}
              <Route path="/app" element={
                <PrivateRoute>
                  <Layout><Analyze /></Layout>
                </PrivateRoute>
              } />
              <Route path="/history" element={
                <PrivateRoute>
                  <Layout><History /></Layout>
                </PrivateRoute>
              } />
              <Route path="/profile" element={
                <PrivateRoute>
                  <Layout><Profile /></Layout>
                </PrivateRoute>
              } />
              <Route path="/reports" element={
                <PrivateRoute>
                  <Layout><Reports /></Layout>
                </PrivateRoute>
              } />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
