import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import Layout from './components/Layout'
// ── Login грузим статически: это входная точка и LCP-страница,
//    она должна отрисоваться из начального бандла без лишнего запроса ──
import Login from './pages/Login'

/* ── code splitting: каждая страница — отдельный чанк.
   Analyze утянет за собой PDF/3D-обёртки (сами движки — ещё глубже,
   через lazy в PlyViewer / RaschetDownloadButton / ReportPanel),
   а логин-страница останется лёгкой. Чанк качается при первом
   переходе на страницу и дальше сидит в кеше. ── */
const Landing  = lazy(() => import('./pages/Landing'))   // ← публичный лендинг ( / )
const Register = lazy(() => import('./pages/Register'))
const Analyze  = lazy(() => import('./pages/Analyze'))
const History  = lazy(() => import('./pages/History'))
const Profile  = lazy(() => import('./pages/Profile'))
const Privacy  = lazy(() => import('./pages/Privacy'))
const NotFound = lazy(() => import('./pages/NotFound'))

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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
