import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../../theme/ThemeProvider'
import { OPTS as THEME_OPTS } from '../ThemeToggle'
import Barcode from './Barcode'
import { EV, emitArchive } from './bus'

/* ============================================================
   ArchiveChrome — «железо» темы «Архив»: системная шапка,
   навигация, панель задач и подвал. Подменяет собой шапку/футер
   из Layout, когда включена тема archive.
   ------------------------------------------------------------
   Что здесь РЕАЛЬНОЕ, а что — оформление:
   • пользователь, организация, выход, разделы, часы, состояние
     связи — живые данные;
   • ВИДЕОКАРТА / ПАМЯТЬ — декоративные константы (MACHINE):
     у фронта нет телеметрии расчётного узла. Держим их одной
     константой, чтобы, когда бэкенд начнёт отдавать эти цифры,
     менять ровно одно место, а не искать строки по вёрстке;
   • координаты Петрозаводска — настоящие.
   ============================================================ */

/** Показатели расчётного узла. Пока не приходят с сервера — фиксированы. */
export const MACHINE = { gpu: '3090', ramGb: '24.0' }

const VERSION = 'СИС. 02.26'
const GEO     = 'ПЕТРОЗАВОДСК · КАРЕЛИЯ · 61.78 С.Ш. 34.35 В.Д.'
const EMAIL   = 'yakov.kachalin@mail.ru'

/* Разделы. Первые два — настоящие маршруты приложения, третий и
   четвёртый в системе не подключены: по ТЗ они присутствуют в
   полосе, но приглушены (opacity .45) и не кликаются. */
const TABS = [
  { no: '01', label: 'АНАЛИЗ',  to: '/app' },
  { no: '02', label: 'АРХИВ',   to: '/history' },
  { no: '03', label: 'ОБЪЕКТЫ', to: null },
  { no: '04', label: 'ОТЧЁТЫ',  to: null },
]

/* ── часы панели задач ───────────────────────────────────────── */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // выравниваемся по началу минуты: часы показывают ЧЧ:ММ,
    // тикать секундным интервалом ради этого незачем
    let timer
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, 60000 - (Date.now() % 60000))
    }
    timer = setTimeout(tick, 60000 - (Date.now() % 60000))
    return () => clearTimeout(timer)
  }, [])
  return (
    <time className="arc-task__clock" dateTime={now.toISOString()}>
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
    </time>
  )
}

/* ── меню ПУСК: разделы, тема, выход ─────────────────────────── */
function StartMenu({ open, onClose, onSignOut }) {
  const { mode, setTheme } = useTheme()
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey  = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="arc-start" ref={ref} role="menu" aria-label="Меню системы">
      <div className="arc-start__side" aria-hidden="true">СИСТЕМА</div>
      <div className="arc-start__body">
        <Link className="arc-start__item" to="/app" role="menuitem" onClick={onClose}>АНАЛИЗ</Link>
        <Link className="arc-start__item" to="/history" role="menuitem" onClick={onClose}>АРХИВ</Link>
        <Link className="arc-start__item" to="/profile" role="menuitem" onClick={onClose}>УЧЁТНАЯ ЗАПИСЬ</Link>

        <div className="arc-start__sep" role="separator" />
        <div className="arc-start__label">ОФОРМЛЕНИЕ</div>
        <div className="arc-start__themes">
          {THEME_OPTS.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              aria-checked={mode === o.key}
              className={`arc-start__theme${mode === o.key ? ' is-active' : ''}`}
              onClick={() => setTheme(o.key)}
            >
              {o.key === 'light' ? 'СВЕТЛАЯ' : o.key === 'dark' ? 'ТЁМНАЯ' : 'АРХИВ'}
            </button>
          ))}
        </div>

        <div className="arc-start__sep" role="separator" />
        <button type="button" className="arc-start__item arc-start__item--exit" role="menuitem" onClick={onSignOut}>
          ЗАВЕРШИТЬ СЕАНС
        </button>
      </div>
    </div>
  )
}

export default function ArchiveChrome({ user, profile, onSignOut, children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [startOpen, setStartOpen] = useState(false)
  const [cubeOn, setCubeOn]       = useState(false)
  const [online, setOnline]       = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const path     = location.pathname
  const onAnalyze = path === '/app'
  const onArchive = path === '/history'

  // Номер пользователя — стабильный, из uuid: показывать сам uuid в
  // «полевом» интерфейсе незачем, а выдумывать номер нельзя.
  const userNo = user?.id ? user.id.replace(/\D/g, '').slice(0, 3).padStart(3, '0') : '000'
  const userName = (profile?.name || user?.email || 'ОПЕРАТОР').toUpperCase()
  const org = (profile?.company || 'ОРГАНИЗАЦИЯ НЕ УКАЗАНА').toUpperCase()

  /* «ВВОД_СНИМКОВ.ПРГ»: на странице анализа открывает выбор файлов
     сразу, из архива — сперва уводит на /app. Событие подхватит
     ArchiveAnalyze после монтирования (см. bus.js, pending). */
  const pickFiles = () => {
    if (!onAnalyze) navigate('/app')
    emitArchive(EV.PICK_FILES)
  }
  const toggleCube = () => {
    if (!onAnalyze) navigate('/app')
    setCubeOn((v) => !v)
    emitArchive(EV.CUBE)
  }

  return (
    <div className="arc">
      {/* ── СИСТЕМНАЯ ШАПКА ─────────────────────────────────── */}
      <header className="arc-sys">
        <Link to="/app" className="arc-sys__brand">
          <span className="arc-ico-check" aria-hidden="true" />
          <b>КАРЕЛИЯ СТРОЙ</b>
          <span className="arc-sys__sub">/ СИСТЕМА ПОЛЕВОГО АНАЛИЗА</span>
        </Link>

        <div className="arc-sys__mach">
          <span><i>ВИДЕОКАРТА</i> {MACHINE.gpu}</span>
          <span><i>ПАМЯТЬ</i> {MACHINE.ramGb} ГБ</span>
        </div>

        <div className="arc-sys__user">
          <Link to="/profile" className="arc-sys__who" title="Учётная запись">
            <span>ПОЛЬЗ_{userNo} · {userName}</span>
            <span className="arc-sys__org">{org}</span>
          </Link>
          <button type="button" className="arc-sys__exit" onClick={onSignOut} aria-label="Завершить сеанс">
            [→]
          </button>
          <span className="arc-sys__ver">{VERSION}</span>
        </div>
      </header>

      {/* ── НАВИГАЦИЯ ───────────────────────────────────────── */}
      <nav className="arc-nav" aria-label="Разделы системы">
        <div className="arc-nav__tabs">
          {TABS.map((t) => {
            const active = t.to && path === t.to
            if (!t.to) {
              return (
                <span key={t.no} className="arc-nav__tab is-off" aria-disabled="true" title="РАЗДЕЛ НЕ ПОДКЛЮЧЁН">
                  [{t.no} {t.label}]
                </span>
              )
            }
            return (
              <Link
                key={t.no}
                to={t.to}
                className={`arc-nav__tab${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                [{t.no} {t.label}]
              </Link>
            )
          })}
        </div>
        <div className="arc-nav__geo">{GEO}</div>
      </nav>

      {/* ── СОДЕРЖИМОЕ РАЗДЕЛА ──────────────────────────────── */}
      <main className="arc-main">{children}</main>

      {/* ── ПАНЕЛЬ ЗАДАЧ ────────────────────────────────────── */}
      <div className="arc-task">
        <div className="arc-task__wrap">
          <button
            type="button"
            className={`arc-task__start${startOpen ? ' is-down' : ''}`}
            onClick={() => setStartOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={startOpen}
          >
            <span className="arc-ico-check" aria-hidden="true" />
            ПУСК
          </button>

          <div className="arc-task__btns">
            <Link to="/app" className={`arc-task__btn${onAnalyze ? ' is-down' : ''}`}>АНАЛИЗ.ПРГ</Link>
            <Link to="/history" className={`arc-task__btn${onArchive ? ' is-down' : ''}`}>АРХИВ.ПРГ</Link>
            <button type="button" className="arc-task__btn" onClick={pickFiles}>ВВОД_СНИМКОВ.ПРГ</button>
            <button
              type="button"
              className={`arc-task__btn${cubeOn && onAnalyze ? ' is-down' : ''}`}
              onClick={toggleCube}
              aria-pressed={cubeOn && onAnalyze}
            >
              СВОЙСТВА_КУБА
            </button>
          </div>

          <Barcode className="arc-code--task" caption={null} />
          <span className={`arc-task__led${online ? '' : ' is-off'}`} aria-hidden="true" />
          <Clock />
        </div>

        <StartMenu open={startOpen} onClose={() => setStartOpen(false)} onSignOut={onSignOut} />
      </div>

      {/* ── ПОДВАЛ (под панелью задач) ──────────────────────── */}
      <footer className="arc-foot">
        <span>© 2026 КАРЕЛИЯ СТРОЙ — СИСТЕМА ПОЛЕВОГО АНАЛИЗА · ПЕТРОЗАВОДСК</span>
        <span className="arc-foot__right">
          <Link to="/privacy" className="arc-foot__link">ПОЛИТИКА ДАННЫХ</Link>
          <a href={`mailto:${EMAIL}`} className="arc-foot__link">ПОЧТА</a>
          <span className={`arc-foot__state${online ? '' : ' is-off'}`}>
            ● {online ? 'НА СВЯЗИ' : 'НЕТ СВЯЗИ'}
          </span>
        </span>
      </footer>
    </div>
  )
}
