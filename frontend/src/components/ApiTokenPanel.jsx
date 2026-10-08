import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

/* ─────────────────────────────────────────────────────────────────────────
   Токен для Swagger — панель суперадмина в «Профиле», под «Расчётным сервером».

   Swagger (/api/docs) в «Authorize» ждёт токен сессии — ту самую строку, что
   уходит в каждом запросе к /api в заголовке `Authorization: Bearer …`. Раньше
   её выковыривали из DevTools → Network → Headers; здесь она в поле с кнопкой
   «Скопировать».

   Это токен ТЕКУЩЕЙ сессии вошедшего: ничего нового не выпускается, с сервера
   ничего не запрашивается — значение берётся из хранилища сессии в браузере.
   Живёт он недолго (срок задаёт GoTrue на сервере, обычно час) и обновляется
   сам; поле следит за сменой и показывает актуальный. «Обновить» — выпустить
   новый сейчас, не дожидаясь срока.

   Показывается только суперадмину (pages/Profile.jsx). Прав токен не добавляет:
   это вход того же пользователя, что смотрит на страницу.
   ───────────────────────────────────────────────────────────────────────── */

export default function ApiTokenPanel() {
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')               // подсказка, если буфер обмена недоступен
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const copiedTimer = useRef(null)

  const take = (session) => setToken(session?.access_token || '')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) take(data?.session) }).catch(() => {})
    // токен обновляется сам (autoRefreshToken) — поле должно показывать новый
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive && session) take(session)
    })
    return () => { alive = false; subscription.unsubscribe(); clearTimeout(copiedTimer.current) }
  }, [])

  const copy = async () => {
    setNote('')
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2500)
    } catch {
      // буфер обмена закрыт (http, старый браузер) — выделяем, дальше руками
      inputRef.current?.select()
      setNote('Токен выделен — скопируйте его сочетанием Ctrl+C (⌘C).')
    }
  }

  const refresh = async () => {
    setError(''); setNote('')
    setBusy(true)
    try {
      const { data, error: err } = await supabase.auth.refreshSession()
      if (err || !data?.session) setError('Не удалось обновить токен. Проверьте связь и попробуйте ещё раз.')
      else take(data.session)
    } catch {
      setError('Не удалось обновить токен. Проверьте связь и попробуйте ещё раз.')
    }
    setBusy(false)
  }

  return (
    <div className="kb-admin">
      <div className="kb-admin-head">
        <span className="kb-account-title">Токен для Swagger</span>
        <span className="kb-admin-badge">Администратор</span>
      </div>

      <div className="kb-field kb-admin-field" style={{ marginTop: 0 }}>
        <input id="api-token" ref={inputRef} className="kb-token" type="text" readOnly
               aria-label="Токен для Swagger"
               spellCheck={false} autoComplete="off"
               value={token} placeholder="сессия не найдена — войдите заново"
               onFocus={e => e.target.select()} />
      </div>

      <div className="kb-admin-actions">
        <button type="button" className="btn btn-primary" onClick={copy} disabled={!token}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Обновляем…' : 'Обновить'}
        </button>
        {note && <span className="kb-actions-note">{note}</span>}
      </div>

      {error && (
        <div className="status error" role="alert"><div><strong>Токен не обновился</strong>{error}</div></div>
      )}
    </div>
  )
}
