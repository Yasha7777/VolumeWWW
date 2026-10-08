import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Возврат по ссылке из письма (подтверждение почты) при сбое: GoTrue кладёт
// причину в адрес (?error=…&error_description=…, у старых ссылок — в #hash).
function linkErrorFromUrl() {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (!(q.get('error') || h.get('error'))) return ''
  return 'Ссылка недействительна или устарела. Войдите по почте и паролю.'
}

export default function Login() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(linkErrorFromUrl)
  const [loading, setLoading] = useState(false)
  // Поля с ошибкой: { email?: текст, password?: текст }. Подсвечиваются все
  // сразу (styles.css, .auth-field.is-invalid), подпись — под каждым.
  const [bad, setBad] = useState({})
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const edit = (setter, key) => (e) => {
    setter(e.target.value)
    if (bad[key]) setBad((b) => { const n = { ...b }; delete n[key]; return n })
    if (error) setError('')
  }
  // true, пока в адресе одноразовый ?code=… из ссылки в письме и клиент меняет его на сессию
  const [returning, setReturning] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code'))

  // Обмен кода не удался (код протух, нет связи) — не держим «Входим…» вечно.
  useEffect(() => {
    if (!returning) return
    const t = setTimeout(() => setReturning(false), 15000)
    return () => clearTimeout(t)
  }, [returning])

  // Как только сессия появилась (вход по ссылке из письма) — в приложение.
  // Заодно: уже вошедшему форма входа не нужна.
  useEffect(() => {
    if (user) navigate('/app', { replace: true })
  }, [user, navigate])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const b = {}
    if (!email.trim()) b.email = 'Введите адрес электронной почты'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) b.email = 'Адрес почты указан с ошибкой'
    if (!password) b.password = 'Введите пароль'
    setBad(b)
    if (b.email || b.password) {
      (b.email ? emailRef : passwordRef).current?.focus()   // курсор — в первое поле с ошибкой
      return
    }
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
        <p className="auth-sub">Volumetric Gottland — объём и масса по фото</p>

        <form onSubmit={submit} noValidate>
          <div className={`auth-field${bad.email ? ' is-invalid' : ''}`}>
            <label htmlFor="login-email">Эл. почта</label>
            <input
              id="login-email" ref={emailRef}
              type="email" required autoFocus autoComplete="email"
              value={email} onChange={edit(setEmail, 'email')}
              placeholder="you@company.ru"
              aria-invalid={!!bad.email} aria-describedby={bad.email ? 'login-email-err' : undefined}
            />
            {bad.email && <div className="auth-field__err" id="login-email-err" role="alert">{bad.email}</div>}
          </div>
          <div className={`auth-field${bad.password ? ' is-invalid' : ''}`}>
            <label htmlFor="login-password">Пароль</label>
            <input
              id="login-password" ref={passwordRef}
              type="password" required autoComplete="current-password"
              value={password} onChange={edit(setPassword, 'password')}
              placeholder="••••••••"
              aria-invalid={!!bad.password} aria-describedby={bad.password ? 'login-password-err' : undefined}
            />
            {bad.password && <div className="auth-field__err" id="login-password-err" role="alert">{bad.password}</div>}
          </div>

          {error && <div className="auth-err">{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading || returning ? <><div className="spinner" /> Входим...</> : 'Войти'}
          </button>
        </form>

        <p className="auth-switch">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  )
}
