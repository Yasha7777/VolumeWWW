import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEffect, useState } from 'react'
import { api } from '../api'
import ThemeToggle from './swag/ThemeToggle'   // ← сегментный переключатель тем

/* ============================================================
   Нижняя навигация (mobile tab bar).
   На десктопе скрыта через CSS — там работает обычное меню в шапке.
   На мобиле меню из шапки прячется, а внизу появляется таб-бар
   с крупными зонами тапа и «бегунком»-чёрточкой над активной вкладкой.
   ============================================================ */
const NAV = [
  {
    to: '/',
    label: 'Анализ',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-3l-2.5-3Z" />
        <circle cx="12" cy="13" r="3.2" />
      </svg>
    ),
  },
  {
    to: '/history',
    label: 'История',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5" />
        <path d="M3.05 11a9 9 0 1 0 2.6-6.4L3 8" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'Профиль',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
]

export default function Layout({ children }) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (user) api.getProfile().then(setProfile).catch(() => {})
  }, [user])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = (profile?.name || user?.email || '?')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const isActive = (path) => location.pathname === path ? 'nav-btn active' : 'nav-btn'

  // индекс активной вкладки для «бегунка» нижней навигации (-1 → прячем)
  const tabIndex = NAV.findIndex(t => t.to === location.pathname)

  return (
    <>
      <header>
        <Link to="/" className="logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div>
            <div className="logo-name">Карелия Строй</div>
            <div className="logo-sub">AI Анализ Фото</div>
          </div>
        </Link>

        {/* десктопное меню — скрывается на мобиле (CSS), снизу появляется таб-бар */}
        <nav className="nav-desktop">
          <Link to="/" className={isActive('/')}>Анализ</Link>
          <Link to="/history" className={isActive('/history')}>История</Link>
          <Link to="/profile" className={isActive('/profile')}>Профиль</Link>
        </nav>

        <div className="user-block">
          <div className="user-info">
            <div className="user-name">{profile?.name || user?.email}</div>
            {profile?.company && <div className="user-co">{profile.company}</div>}
          </div>
          {/* переключатель тем: светлая / тёмная / готическая (gtc) */}
          <ThemeToggle />
          <button className="icon-btn" title="Выйти" onClick={handleSignOut}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <main>{children}</main>

      <footer style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px', fontSize: 13, color: 'var(--muted)' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span>© 2026 Карелия Строй — AI сервис</span>
          <span>Петрозаводск · Карелия</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>
            Политика конфиденциальности
          </Link>
          <span>·</span>
          <span
            onClick={() => {
              navigator.clipboard.writeText('yakov.kachalin@mail.ru');
              alert('Email скопирован: yakov.kachalin@mail.ru');
            }}
            title="Нажмите, чтобы скопировать"
            style={{ color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
          >
            yakov.kachalin@mail.ru
          </span>
        </div>
      </footer>

      {/* распорка, чтобы футер/контент не уходили под фиксированную навигацию */}
      <div className="tabbar-spacer" aria-hidden="true" />

      {/* нижняя навигация — видна только на мобиле (display задаётся в CSS) */}
      <nav className="tabbar" aria-label="Основная навигация">
        <span
          className="tabbar__thumb"
          style={{
            transform: `translateX(${(tabIndex < 0 ? 0 : tabIndex) * 100}%)`,
            opacity: tabIndex < 0 ? 0 : 1,
          }}
          aria-hidden="true"
        />
        {NAV.map((t) => {
          const active = location.pathname === t.to
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`tabbar__item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="tabbar__icon">{t.icon}</span>
              <span className="tabbar__label">{t.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
