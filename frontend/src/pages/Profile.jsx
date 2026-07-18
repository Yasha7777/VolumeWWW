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

function Landscape() {
  return (
    <svg className="kb-scene" viewBox="0 0 420 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
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
      </defs>

      <rect x="0" y="0" width="420" height="200" fill="url(#kbSky)" />

      <g className="kb-sun">
        <circle cx="332" cy="54" r="32" fill="var(--kb-sun-glow)" opacity="0.5" />
        <circle cx="332" cy="54" r="19" fill="url(#kbSun)" />
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
                  <button type="button" className="kb-icon-btn" aria-label="Удалить email" onClick={() => removeEmail(idx)}>✕</button>
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
