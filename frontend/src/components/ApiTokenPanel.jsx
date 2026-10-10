import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Save } from 'lucide-react'
import { supabase } from '../supabase'
import { api } from '../api'

/* ─────────────────────────────────────────────────────────────────────────
   Swagger — панель суперадмина в «Профиле», под «Расчётным сервером».

   • Пароль к /api/docs зашит в бэкенде (app/apidocs.py, DOCS_PASSWORD) и
     приходит с сервера (`GET /api/admin/docs-password`, только суперадмину).
     Во фронт его не вшиваем: бандл публичный.
   • Токен — access_token ТЕКУЩЕЙ сессии, его Swagger ждёт в «Authorize».
     Берётся из хранилища сессии в браузере, ничего нового не выпускается.
     Живёт около часа (срок задаёт GoTrue) и обновляется сам — строка следит.

   Значения — текст, а не поля ввода: их не редактируют, только копируют.
   ───────────────────────────────────────────────────────────────────────── */

function SecretRow({ label, value, empty }) {
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)        // буфер обмена закрыт — выделили текст
  const valueRef = useRef(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    setManual(false)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // http или старый браузер — выделяем значение, дальше Ctrl+C
      const range = document.createRange()
      range.selectNodeContents(valueRef.current)
      const sel = window.getSelection()
      sel.removeAllRanges(); sel.addRange(range)
      setManual(true)
    }
  }

  return (
    <div className="kb-secret">
      <span className="kb-secret-label">{label}</span>
      <span ref={valueRef} className={`kb-secret-value${value ? '' : ' is-empty'}`} title={value || undefined}>
        {value || empty}
      </span>
      <button type="button" className={`kb-secret-copy${copied ? ' is-done' : ''}`}
              onClick={copy} disabled={!value}
              aria-label={`Скопировать: ${label.toLowerCase()}`}
              title={manual ? 'Выделено — нажмите Ctrl+C (⌘C)' : copied ? 'Скопировано' : 'Скопировать'}>
        {copied ? <Check size={16} strokeWidth={2.25} /> : <Save size={16} strokeWidth={1.75} />}
      </button>
      <span className="kb-sr" aria-live="polite">
        {copied ? `${label} скопирован` : manual ? 'Выделено, нажмите Ctrl+C' : ''}
      </span>
    </div>
  )
}

export default function ApiTokenPanel() {
  const [token, setToken] = useState('')
  const [docs, setDocs] = useState({ password: '', url: '/api/docs', state: 'loading' })

  const take = (session) => setToken(session?.access_token || '')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) take(data?.session) }).catch(() => {})
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive && session) take(session)
    })
    api.adminDocsPassword()
      .then(d => { if (alive) setDocs({ password: d?.password || '', url: d?.docs_url || '/api/docs', state: 'ok' }) })
      .catch(() => { if (alive) setDocs(s => ({ ...s, state: 'error' })) })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  return (
    <div className="kb-admin">
      <div className="kb-admin-head">
        <span className="kb-account-title">Swagger</span>
        <a className="kb-admin-link" href={docs.url} target="_blank" rel="noopener">
          Открыть <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
        </a>
      </div>

      <div className="kb-secrets">
        <SecretRow label="Пароль" value={docs.password}
                   empty={docs.state === 'error' ? 'не загрузился — обновите страницу' : 'загружается…'} />
        <SecretRow label="Токен" value={token} empty="сессии нет — войдите заново" />
      </div>
    </div>
  )
}
