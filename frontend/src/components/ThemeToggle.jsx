import { useTheme } from '../theme/ThemeProvider'

/* ============================================================
   ThemeToggle — сегментный переключатель тем в шапке сайта.
   3 позиции: Светлая (☀) · Тёмная (🌙) · Архив (▤).
   Скользящий «бегунок» едет к активной позиции.

   В теме «Архив» шапки из Layout нет — там свой переключатель
   в системной строке (components/archive/ArchiveChrome.jsx),
   но компонент один и тот же: список OPTS общий.
   ============================================================ */

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

/* «Архив» — картотечный ящик: три горизонтальные полосы в рамке.
   Контурный мотив, как и остальные иконки шапки. */
const ArchiveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
    <rect x="3" y="4" width="18" height="16" />
    <path d="M3 9h18M3 14h18M10 6.5h4M10 11.5h4M10 16.5h4" />
  </svg>
)

export const OPTS = [
  { key: 'light',   label: 'Светлая тема', Icon: SunIcon },
  { key: 'dark',    label: 'Тёмная тема',  Icon: MoonIcon },
  { key: 'archive', label: 'Тема «Архив»', Icon: ArchiveIcon },
]

export default function ThemeToggle() {
  const { mode, setTheme } = useTheme()
  const index = Math.max(0, OPTS.findIndex((o) => o.key === mode))

  return (
    <div className="theme-switch" role="group" aria-label="Тема оформления">
      <span className="theme-switch__thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {OPTS.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`theme-switch__opt${mode === o.key ? ' is-active' : ''}`}
          onClick={() => setTheme(o.key)}
          title={o.label}
          aria-label={o.label}
          aria-pressed={mode === o.key}
        >
          <o.Icon />
        </button>
      ))}
    </div>
  )
}
