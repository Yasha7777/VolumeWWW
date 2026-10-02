import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Возврат с Яндекса при отказе или сбое: GoTrue кладёт причину в адрес
// (?error=…&error_description=…, у старых ссылок — в #hash).
function oauthErrorFromUrl() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const code = q.get('error') || h.get('error')
  if (!code) return ''
  if (code === 'access_denied') return 'Вход через Яндекс отменён.'
  return 'Не удалось войти через Яндекс. Попробуйте ещё раз или войдите по почте.'
}

export default function Login() {
  const { signIn, signInWithYandex, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(oauthErrorFromUrl)
  const [loading, setLoading] = useState(false)
  // true, пока в адресе одноразовый ?code=… от Яндекса и клиент меняет его на сессию
  const [returning, setReturning] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code'))

  // Обмен кода не удался (код протух, нет связи) — не держим «Входим…» вечно.
  useEffect(() => {
    if (!returning) return
    const t = setTimeout(() => setReturning(false), 15000)
    return () => clearTimeout(t)
  }, [returning])

  // Сюда возвращает Яндекс (AuthContext.signInWithYandex). Как только сессия
  // появилась — в приложение. Заодно: уже вошедшему форма входа не нужна.
  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [user, navigate])

  const yandex = async () => {
    setError('')
    setLoading(true)
    const { error: err } = await signInWithYandex()
    // при успехе браузер уже уходит на Яндекс; сюда попадаем только при сбое
    if (err) { setLoading(false); setError('Не удалось открыть вход через Яндекс. Проверьте связь.') }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    setLoading(false)
    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Неверный email или пароль'
        : err.message)
    } else {
      navigate('/app')
    }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
        </div>

        <h1 className="auth-h1">Вход в сервис</h1>
        <p className="auth-sub">Карелия Строй — ИИ-анализ материалов</p>

        <form onSubmit={submit}>
          <div className="auth-field">
            <label>Эл. почта</label>
            <input
              type="email" required autoFocus autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.ru"
            />
          </div>
          <div className="auth-field">
            <label>Пароль</label>
            <input
              type="password" required autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <div className="auth-err">{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading || returning ? <><div className="spinner" /> Входим...</> : 'Войти'}
          </button>
        </form>

        <div className="auth-or">или</div>
        <button type="button" className="btn auth-submit auth-alt" disabled={loading} onClick={yandex}>
          Войти через Яндекс
        </button>
        <p className="auth-note">
          Первый вход через Яндекс создаёт учётную запись. Сервис получит от Яндекса адрес почты и имя;
          перед началом работы попросим <Link to="/consent" target="_blank">согласие на обработку данных</Link>.
        </p>

        <p className="auth-switch">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  )
}
