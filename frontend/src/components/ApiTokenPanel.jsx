import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { api } from '../api'

/* ─────────────────────────────────────────────────────────────────────────
   Swagger — панель суперадмина в «Профиле», под «Расчётным сервером».
   Всё, что нужно, чтобы открыть /api/docs и пользоваться «Try it out»:

   • Пароль страницы. Зашит в бэкенде (app/apidocs.py, DOCS_PASSWORD) и
     приходит с сервера (`GET /api/admin/docs-password`, только суперадмину).
     Во фронт его не вшиваем: бандл публичный, и пароль прочитал бы любой.

   • Токен. Swagger в «Authorize» ждёт токен сессии — ту самую строку, что
     уходит в каждом запросе к /api в заголовке `Authorization: Bearer …`.
     Это токен ТЕКУЩЕЙ сессии вошедшего: ничего нового не выпускается, значение
     берётся из хранилища сессии в браузере. Живёт он недолго (срок задаёт
     GoTrue на сервере, обычно час) и обновляется сам; поле следит за сменой и
     показывает актуальный. Прав токен не добавляет: это вход того же
     пользователя, что смотрит на страницу.

   У каждого поля справа 💾 — скопировать в буфер обмена.
   Показывается только суперадмину (pages/Profile.jsx).
   ───────────────────────────────────────────────────────────────────────── */

function CopyField({ id, label, value, placeholder, first }) {
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState('')               // подсказка, если буфер обмена недоступен
  const inputRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    setNote('')
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2500)
    } catch {
      // буфер обмена закрыт (http, старый браузер) — выделяем, дальше руками
      inputRef.current?.select()
      setNote('Выделено — скопируйте сочетанием Ctrl+C (⌘C).')
    }
  }

  return (
    <div className="kb-field kb-admin-field" style={first ? { marginTop: 0 } : undefined}>
      <label htmlFor={id}>{label}</label>
      <div className="kb-copy">
        <input id={id} ref={inputRef} className="kb-token" type="text" readOnly
               spellCheck={false} autoComplete="off"
               value={value} placeholder={placeholder}
               onFocus={e => e.target.select()} />
        <button type="button" className={`kb-copy-btn${copied ? ' is-done' : ''}`}
                onClick={copy} disabled={!value}
                title={copied ? 'Скопировано' : 'Скопировать'}
                aria-label={copied ? 'Скопировано' : `Скопировать: ${label.toLowerCase()}`}>
          {copied ? '✓' : '💾'}
        </button>
      </div>
      {note && <div className="kb-hint">{note}</div>}
    </div>
  )
}

export default function ApiTokenPanel() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [pwState, setPwState] = useState('loading')  // loading | ok | error

  const take = (session) => setToken(session?.access_token || '')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) take(data?.session) }).catch(() => {})
    // токен обновляется сам (autoRefreshToken) — поле должно показывать новый
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive && session) take(session)
    })
    api.adminDocsPassword()
      .then(d => { if (alive) { setPassword(d?.password || ''); setPwState('ok') } })
      .catch(() => { if (alive) setPwState('error') })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  return (
    <div className="kb-admin">
      <div className="kb-admin-head">
        <span className="kb-account-title">Swagger</span>
        <span className="kb-admin-badge">Администратор</span>
      </div>

      <CopyField id="docs-password" label="Пароль страницы" value={password} first
                 placeholder={pwState === 'error' ? 'не удалось получить — обновите страницу' : 'загружаем…'} />
      <CopyField id="api-token" label="Токен" value={token}
                 placeholder="сессия не найдена — войдите заново" />
    </div>
  )
}
