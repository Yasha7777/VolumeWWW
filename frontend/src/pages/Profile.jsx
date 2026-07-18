import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import './Profile.css'

/* ───────────────────────── helpers ───────────────────────── */

function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target == null || isNaN(Number(target))) { setVal(0); return }
    const to = Number(target)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setVal(to); return }
    let raf, start
    const step = (t) => {
      if (!start) start = t
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(to * eased)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

const fmtInt = (n) => Math.round(n).toLocaleString('ru-RU')

// маска российского номера: +7 (XXX) XXX-XX-XX
function formatPhoneRu(input) {
  let d = String(input ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d[0] === '8') d = '7' + d.slice(1)
  if (d[0] !== '7') d = '7' + d
  d = d.slice(0, 11)
  const p = d.slice(1)
  let out = '+7'
  if (p.length > 0) out += ' (' + p.slice(0, 3)
  if (p.length >= 3) out += ')'
  if (p.length > 3) out += ' ' + p.slice(3, 6)
  if (p.length > 6) out += '-' + p.slice(6, 8)
  if (p.length > 8) out += '-' + p.slice(8, 10)
  return out
}

// нормализация для сравнения «изменилось ли»
const normForm = (o) => JSON.stringify({
  company:  (o.company  || '').trim(),
  position: (o.position || '').trim(),
  city:     (o.city     || '').trim(),
  phone:    (o.phone    || '').replace(/\D/g, ''),
  emails:   (o.emails   || []).map(e => e.trim()).filter(Boolean),
})

/* ───────────────────────── decor ───────────────────────── */

// Времена суток: палитра неба/воды + позиция светила на дуге. Стартовая фаза —
// по локальному времени; клик по светилу или плашке переводит на следующую.
const PHASES = [
  { key:'dawn', label:'Рассвет', body:'sun', cx:80, cy:104, v:{
    '--kb-sky-top':'#aeb9d0','--kb-sky-bot':'#f2dcc4',
    '--kb-sun-core':'#f7c56a','--kb-sun-edge':'#f3b485','--kb-sun-glow':'#f6d7a6',
    '--kb-hill-far':'#95a78c','--kb-hill-near':'#263c1b',
    '--kb-lake-top':'#b7b1af','--kb-lake-bot':'#cbc3b6','--kb-ripple':'#ffffff' } },
  { key:'day', label:'День', body:'sun', cx:210, cy:46, v:{
    '--kb-sky-top':'#c8d6d2','--kb-sky-bot':'#e7e1d0',
    '--kb-sun-core':'#ebc75a','--kb-sun-edge':'#f1d98c','--kb-sun-glow':'#f3e2a6',
    '--kb-hill-far':'#9db08c','--kb-hill-near':'#2f4a1c',
    '--kb-lake-top':'#a6b6ae','--kb-lake-bot':'#bcc4b2','--kb-ripple':'#ffffff' } },
  { key:'golden', label:'Золотой час', body:'sun', cx:334, cy:92, v:{
    '--kb-sky-top':'#e7c497','--kb-sky-bot':'#f7e7c6',
    '--kb-sun-core':'#f2a04c','--kb-sun-edge':'#f0b568','--kb-sun-glow':'#f7cf92',
    '--kb-hill-far':'#a99a70','--kb-hill-near':'#38331a',
    '--kb-lake-top':'#c9b596','--kb-lake-bot':'#d9c9a8','--kb-ripple':'#ffe6c4' } },
  { key:'dusk', label:'Сумерки', body:'sun', cx:384, cy:128, v:{
    '--kb-sky-top':'#575680','--kb-sky-bot':'#dd9c7c',
    '--kb-sun-core':'#e8734e','--kb-sun-edge':'#de8b6a','--kb-sun-glow':'#eca47e',
    '--kb-hill-far':'#6b7074','--kb-hill-near':'#211b2b',
    '--kb-lake-top':'#7c6c7a','--kb-lake-bot':'#8b7b71','--kb-ripple':'#f2c4a4' } },
  { key:'night', label:'Ночь', body:'moon', cx:314, cy:50, aurora:true, v:{
    '--kb-sky-top':'#0e1c34','--kb-sky-bot':'#1c2d49',
    '--kb-sun-core':'#eef1f8','--kb-sun-edge':'#ccd6e8','--kb-sun-glow':'#aebdd6',
    '--kb-hill-far':'#2b3b4b','--kb-hill-near':'#0c1421',
    '--kb-lake-top':'#142236','--kb-lake-bot':'#1d2d43','--kb-ripple':'#7fb2c2' } },
]

function phaseFromHour(h) {
  if (h >= 5  && h < 8)  return 0
  if (h >= 8  && h < 16) return 1
  if (h >= 16 && h < 19) return 2
  if (h >= 19 && h < 21) return 3
  return 4
}

const SunIco  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
const MoonIco = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>

function Landscape() {
  const [i, setI] = useState(() => phaseFromHour(new Date().getHours()))
  const p = PHASES[i]
  const next = () => setI(v => (v + 1) % PHASES.length)
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next() } }

  return (
    <>
      <svg className="kb-scene" style={p.v} viewBox="0 0 420 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="kbSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--kb-sky-top)" />
            <stop offset="100%" stopColor="var(--kb-sky-bot)" />
          </linearGradient>
          <radialGradient id="kbSun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--kb-sun-core)" />
            <stop offset="60%" stopColor="var(--kb-sun-core)" />
            <stop offset="100%" stopColor="var(--kb-sun-edge)" />
          </radialGradient>
          <linearGradient id="kbLake" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--kb-lake-top)" />
            <stop offset="100%" stopColor="var(--kb-lake-bot)" />
          </linearGradient>
          <linearGradient id="kbAuroraA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#7be8b6" stopOpacity="0" />
            <stop offset="45%"  stopColor="#54e0a6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6f7fe0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="kbAuroraB" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#9ff0d0" stopOpacity="0" />
            <stop offset="50%"  stopColor="#5fd0d8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7a6fe0" stopOpacity="0" />
          </linearGradient>
          <filter id="kbSoft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <rect x="0" y="0" width="420" height="200" fill="url(#kbSky)" />

        {/* северное сияние — только ночью */}
        <g className={`kb-aurora ${p.aurora ? 'is-on' : ''}`} filter="url(#kbSoft)">
          <path className="kb-aur kb-aur-a" d="M40 8 C70 30 60 70 96 96 L150 96 C120 66 128 26 100 8 Z" fill="url(#kbAuroraA)" />
          <path className="kb-aur kb-aur-b" d="M210 6 C244 34 232 74 270 100 L322 100 C288 70 300 30 268 6 Z" fill="url(#kbAuroraB)" />
          <path className="kb-aur kb-aur-c" d="M150 10 C178 34 168 66 198 92 L238 92 C212 66 220 34 196 10 Z" fill="url(#kbAuroraA)" />
        </g>

        {/* звёзды */}
        {p.aurora && (
          <g className="kb-stars" fill="#f2f5ff">
            <circle cx="70" cy="30" r="1" /><circle cx="130" cy="20" r="0.8" />
            <circle cx="250" cy="26" r="1" /><circle cx="360" cy="36" r="0.9" />
            <circle cx="300" cy="18" r="0.7" /><circle cx="180" cy="40" r="0.7" />
          </g>
        )}

        {/* светило — клик/Enter ведёт к следующей фазе */}
        <g
          className="kb-body"
          role="button" tabIndex={0}
          aria-label={`Сменить время суток. Сейчас: ${p.label}`}
          onClick={next} onKeyDown={onKey}
          style={{ transform:`translate(${p.cx}px, ${p.cy}px)` }}
        >
          <circle r="26" fill="transparent" />
          <circle className="kb-orb-glow" r="30" fill="var(--kb-sun-glow)" opacity="0.5" />
          <circle className="kb-orb" r="19" fill="url(#kbSun)" />
          {p.body === 'moon' && (
            <g fill="var(--kb-sun-edge)" opacity="0.45">
              <circle cx="-6" cy="-4" r="3.4" /><circle cx="5" cy="3" r="2.6" /><circle cx="2" cy="-7" r="1.8" />
            </g>
          )}
        </g>

        <path fill="var(--kb-hill-far)" d="M0 138 L18 126 L36 138 L54 124 L72 138 L90 126 L108 138 L126 124 L144 138 L162 126 L180 138 L198 124 L216 138 L234 126 L252 138 L270 124 L288 138 L306 126 L324 138 L342 124 L360 138 L378 126 L396 138 L414 126 L420 132 L420 200 L0 200 Z" />

        <rect x="0" y="146" width="420" height="54" fill="url(#kbLake)" />

        <g fill="var(--kb-hill-near)">
          <path d="M64 72 L55 108 L60 108 L51 127 L58 127 L46 146 L82 146 L70 127 L77 127 L68 108 L73 108 Z" />
          <path d="M116 92 L109 118 L113 118 L106 132 L111 132 L100 146 L132 146 L121 132 L126 132 L119 118 L123 118 Z" />
          <path d="M300 96 L294 120 L298 120 L291 133 L296 133 L286 146 L314 146 L304 133 L309 133 L302 120 L306 120 Z" />
          <path d="M352 70 L343 106 L348 106 L339 126 L346 126 L334 146 L370 146 L358 126 L365 126 L356 106 L361 106 Z" />
        </g>

        <g className="kb-ripple" stroke="var(--kb-ripple)" strokeWidth="1" fill="none" opacity="0.45">
          <line x1="46" y1="162" x2="82" y2="162" />
          <line x1="334" y1="166" x2="370" y2="166" />
          <line x1="100" y1="176" x2="146" y2="176" />
          <line x1="270" y1="184" x2="320" y2="184" />
        </g>
      </svg>

      <button type="button" className="kb-time-btn" onClick={next}
              aria-label={`Время суток: ${p.label}. Нажмите, чтобы сменить`}>
        <span className="kb-time-ico">{p.body === 'moon' ? <MoonIco /> : <SunIco />}</span>
        {p.label}
      </button>
    </>
  )
}

function PetroglyphMark() {
  return (
    <svg className="kb-petro" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M22 70 C22 52 36 44 50 44 C58 44 64 40 64 32 C64 26 60 22 55 22 C58 26 56 32 50 32
               C40 32 30 40 30 54 C30 64 36 70 44 72 L22 72 Z"
            fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="58" cy="29" r="1.6" fill="currentColor" />
    </svg>
  )
}

function Sprig() {
  return (
    <svg className="kb-sprig" viewBox="0 0 60 90" aria-hidden="true">
      <path d="M30 88 L30 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {[20, 34, 48, 62, 74].map((y, i) => (
        <g key={i} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d={`M30 ${y} L${18 - i} ${y + 10}`} />
          <path d={`M30 ${y} L${42 + i} ${y + 10}`} />
        </g>
      ))}
    </svg>
  )
}

/* ───────────────────────── page ───────────────────────── */

export default function Profile() {
  const { user } = useAuth()

  // редактируемые поля формы
  const [name,     setName]     = useState('')   // не редактируется в форме, но входит в снимок
  const [company,  setCompany]  = useState('')
  const [position, setPosition] = useState('')
  const [city,     setCity]     = useState('')
  const [phone,    setPhone]    = useState('')
  const [emails,   setEmails]   = useState([''])

  // снимок последнего сохранения — от него зависят карточка, процент и кнопка
  const [snap,     setSnap]     = useState(null)

  const [stats,    setStats]    = useState({ total: null, success: null })
  const [saved,    setSaved]    = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const savedTimer = useRef(null)

  useEffect(() => {
    api.getProfile().then(p => {
      const ph = formatPhoneRu(p.phone || '')
      const em = p.emails?.length ? p.emails : ['']
      setName(p.name || '')
      setCompany(p.company || '')
      setPosition(p.position || '')
      setCity(p.city || '')
      setPhone(ph)
      setEmails(em)
      setSnap({ name: p.name || '', company: p.company || '', position: p.position || '', city: p.city || '', phone: ph, emails: em })
    }).catch(() => {})

    api.listAnalyses().then(res => {
      const items = Array.isArray(res) ? res : (res?.items || res?.data || res?.results || [])
      const isOk = (it) => ['completed', 'done', 'success', 'ok'].includes(String(it?.status).toLowerCase())
      setStats({ total: items.length, success: items.filter(isOk).length })
    }).catch(() => {})

    return () => clearTimeout(savedTimer.current)
  }, [])

  const setEmail    = (idx, val) => setEmails(prev => prev.map((e, i) => i === idx ? val : e))
  const addEmail    = () => setEmails(prev => [...prev, ''])
  const removeEmail = (idx) => setEmails(prev => prev.filter((_, i) => i !== idx))

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const cleanEmails = emails.map(e => e.trim()).filter(Boolean)
      await api.updateProfile({ name, company, position, city, phone, emails: cleanEmails })
      // фиксируем новый снимок → карточка/процент обновятся, кнопка скроется
      setSnap({ name, company, position, city, phone, emails })
      setSaved(true)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  // есть ли несохранённые изменения
  const dirty = snap ? normForm({ company, position, city, phone, emails }) !== normForm(snap) : false

  // ── всё на карточке слева берётся из снимка (меняется только после сохранения) ──
  const s = snap || { name: '', company: '', position: '', city: '', phone: '', emails: [] }
  const primary = (s.name || '').trim() || (s.company || '').trim() || user?.email || ''
  const sub = ((s.name || '').trim() ? [s.position, s.company] : [s.position]).map(x => (x || '').trim()).filter(Boolean).join(' · ')
  const initSource = (s.name || '').trim() || (user?.email ? user.email.split('@')[0].replace(/[._-]+/g, ' ') : '')
  const initials = initSource.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  // процент заполнения — тоже из снимка
  const snapEmails = (s.emails || []).map(e => e.trim()).filter(Boolean)
  const checks = [s.company, s.position, s.city, s.phone].map(f => !!(f || '').trim())
  checks.push(snapEmails.length > 0)
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100)
  const RING = 2 * Math.PI * 16

  const aTotal   = useCountUp(stats.total)
  const aSuccess = useCountUp(stats.success)

  return (
    <div className="page kb-profile-page">
      <div className="kb-grid">

        {/* ───── идентификация ───── */}
        <aside className="kb-id-card">
          <div className="kb-id-head">
            <Landscape />
            <div className="kb-avatar-wrap"><div className="kb-avatar">{initials}</div></div>
          </div>

          <div className="kb-id-body">
            <h2 className="kb-name">{primary}</h2>
            {sub && <p className="kb-role">{sub}</p>}

            {(s.city || '').trim() && (
              <span className="kb-loc">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" />
                </svg>
                {s.city.trim()}
              </span>
            )}

            <div className="kb-stats">
              <div className="kb-stat">
                <span className="kb-stat-label">Замеров</span>
                <span className="kb-stat-value">{stats.total == null ? '—' : fmtInt(aTotal)}</span>
              </div>
              <div className="kb-stat">
                <span className="kb-stat-label">Успешно</span>
                <span className="kb-stat-value kb-stat-ok">{stats.success == null ? '—' : fmtInt(aSuccess)}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ───── форма ───── */}
        <section className="kb-form-card">
          <Sprig />
          <PetroglyphMark />

          <header className="kb-form-head">
            <h1 className="kb-title">Данные профиля</h1>
            <div className="kb-completeness" title={`Профиль заполнен на ${pct}%`}>
              <svg viewBox="0 0 40 40" width="44" height="44">
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--kb-ring-track)" strokeWidth="4" />
                <circle cx="20" cy="20" r="16" fill="none" stroke="var(--gold)" strokeWidth="4"
                        strokeLinecap="round" strokeDasharray={RING}
                        strokeDashoffset={RING * (1 - pct / 100)}
                        transform="rotate(-90 20 20)" className="kb-ring-fg" />
              </svg>
              <span className="kb-completeness-pct">{pct}%</span>
            </div>
          </header>

          <div className="kb-fields">
            <div className="kb-field">
              <label>Название фирмы</label>
              <input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder={'ООО "Карелия Строй"'} />
            </div>
            <div className="kb-field">
              <label>Должность</label>
              <input type="text" value={position} onChange={e => setPosition(e.target.value)} placeholder="Менеджер, Прораб, Директор…" />
            </div>
            <div className="kb-field">
              <label>Город</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Петрозаводск" />
            </div>
            <div className="kb-field">
              <label>Телефон</label>
              <input type="tel" inputMode="tel" value={phone}
                     onChange={e => setPhone(formatPhoneRu(e.target.value))}
                     placeholder="+7 (___) ___-__-__" />
            </div>
          </div>

          <div className="kb-field kb-field--full">
            <label>Email для получения результатов</label>

            {emails.map((em, idx) => (
              <div key={idx} className="kb-email-row">
                <input type="email" value={em} onChange={e => setEmail(idx, e.target.value)} placeholder="example@mail.ru" />
                {emails.length > 1 && (
                  <button type="button" className="kb-icon-btn" aria-label="Удалить email" onClick={() => removeEmail(idx)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            ))}

            {emails.length < 5 && (
              <button type="button" className="kb-add-email" onClick={addEmail}>
                <span className="kb-add-plus">+</span> Добавить email
              </button>
            )}

            <p className="kb-hint">Результаты анализа придут на эти адреса</p>
          </div>

          {error && (
            <div className="status error"><div><strong>Не удалось сохранить</strong>{error}</div></div>
          )}

          {/* кнопка появляется только при несохранённых изменениях */}
          {dirty && (
            <div className="kb-actions">
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <><div className="spinner" />Сохраняем…</> : 'Сохранить'}
              </button>
              <span className="kb-actions-note">Есть несохранённые изменения</span>
            </div>
          )}

          {saved && (
            <div className="status success"><div><strong>Сохранено</strong>Профиль обновлён.</div></div>
          )}

          <div className="kb-account">
            <div className="kb-account-title">Аккаунт</div>
            <p>Чтобы сменить пароль, воспользуйтесь ссылкой «Забыли пароль?» на странице входа.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
