import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import Layout from './components/Layout'
// ── Login грузим статически: это входная точка и LCP-страница,
//    она должна отрисоваться из начального бандла без лишнего запроса ──
import Login from './pages/Login'
// ── готическая тема: фон, вуаль, разлом (глобально, только в режиме gtc) ──────
import { useTheme } from './theme/ThemeProvider'
import SwagAtmosphere from './components/swag/SwagAtmosphere'
import IntroVeil from './components/swag/IntroVeil'
import Fracture from './components/swag/Fracture'
import SmoothScroll from './components/SmoothScroll'   // ← плавный скролл (Lenis)

/* ── code splitting: каждая страница — отдельный чанк.
   Analyze утянет за собой PDF/3D-обёртки (сами движки — ещё глубже,
   через lazy в PlyViewer / RaschetDownloadButton / ReportPanel),
   а логин-страница останется лёгкой. Чанк качается при первом
   переходе на страницу и дальше сидит в кеше. ── */
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
  // flipping = идёт разлом при входе в gtc → трясём страницу (.az-flip)
  const { flipping } = useTheme()

  return (
    <AuthProvider>
      <BrowserRouter>
        <SmoothScroll />
        {/* фон, вуаль и разлом рендерятся порталом в body и сами решают,
            показываться ли (gtc / flipping). Переключатель тем — в шапке (Layout). */}
        <SwagAtmosphere />
        <IntroVeil />
        <Fracture />

        {/* .app-shell поднимает контент над готической атмосферой (swag.css);
            .az-flip — тряска во время разлома. */}
        <div className={`app-shell${flipping ? ' az-flip' : ''}`}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Публичные */}
              <Route path="/login"    element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/privacy"  element={<Privacy />} />

              {/* Приватные */}
              <Route path="/" element={
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
