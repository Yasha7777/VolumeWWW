import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { consentKnown, consentMeta, hasConsent, takeConsentPending } from '../legal/consent'

/* Окно согласия для вошедшего, у которого нет отметки о согласии с текущей
   редакцией документов (legal/consent.js). Когда показывается:
     • первый вход через Яндекс — учётная запись создаётся без формы
       регистрации, чекбокса человек не видел;
     • учётные записи, созданные до появления /consent и /terms;
     • сменилась CONSENT_VERSION.
   Без отметки в приложение не пускаем: обрабатывать данные без согласия
   нельзя (152-ФЗ). «Выйти» — равноправная кнопка, отказ ничего не удаляет. */
export default function ConsentGate({ children }) {
  const { user, recordConsent, signOut } = useAuth()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needed = consentKnown(user) && !hasConsent(user)

  // Чекбокс уже был отмечен на /register перед уходом на Яндекс —
  // второй раз не спрашиваем, просто записываем отметку.
  useEffect(() => {
    if (!needed) return
    if (takeConsentPending()) recordConsent(consentMeta()).catch(() => {})
  }, [needed]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!needed) return children

  const accept = async () => {
    setError('')
    setBusy(true)
    try {
      const { error: err } = await recordConsent(consentMeta())
      if (err) setError('Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.')
    } catch {
      setError('Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.')
    }
    setBusy(false)
  }

  const link = { color: 'var(--text)', textDecoration: 'underline', fontWeight: 500 }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-h1">Согласие на обработку данных</h1>
        <p className="auth-sub">
          Чтобы пользоваться сервисом, нужно принять условия. Документы обновлены — прочитайте их перед продолжением.
        </p>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 20, textAlign: 'left' }}>
          <input
            type="checkbox" id="consent-gate"
            checked={checked} onChange={(e) => { setChecked(e.target.checked); setError('') }}
            disabled={busy}
            style={{ width: 18, height: 18, minWidth: 18, minHeight: 18, margin: '3px 0 0 0', padding: 0, accentColor: 'var(--green)' }}
          />
          <label htmlFor="consent-gate" style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--muted)', fontWeight: 'normal', textTransform: 'none' }}>
            Я даю <Link to="/consent" target="_blank" style={link}>согласие на обработку персональных данных</Link> и
            принимаю <Link to="/terms" target="_blank" style={link}>Пользовательское соглашение</Link>.
            С <Link to="/privacy" target="_blank" style={link}>Политикой обработки персональных данных</Link> ознакомлен(а).
          </label>
        </div>

        {error && <div className="auth-err" style={{ marginTop: 12 }}>{error}</div>}

        <button type="button" className="btn btn-primary auth-submit" disabled={!checked || busy} onClick={accept} style={{ marginTop: 16 }}>
          {busy ? <><div className="spinner" /> Сохраняем...</> : 'Продолжить'}
        </button>
        <button type="button" className="btn auth-submit auth-alt" disabled={busy} onClick={() => signOut()}>
          Выйти
        </button>

        <p className="auth-switch">
          Отказ ничего не удаляет. Чтобы удалить учётную запись и данные, напишите на yakov.kachalin@mail.ru.
        </p>
      </div>
    </main>
  )
}
