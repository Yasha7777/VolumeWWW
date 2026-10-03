import { useEffect, useRef, useState } from 'react'
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

// Возврат с ВК при сбое: бэкенд (routers/vk_auth.py) кладёт причину в ?vk_error=
const VK_ERRORS = {
  denied: 'Вход через ВКонтакте отменён.',
  noemail: 'ВКонтакте не передал адрес почты. Разрешите доступ к почте на странице входа ВКонтакте или войдите другим способом.',
  off: 'Вход через ВКонтакте сейчас выключен.',
}
const VK_FAIL = 'Не удалось войти через ВКонтакте. Попробуйте ещё раз или войдите по почте.'
function vkFromUrl() {
  if (typeof window === 'undefined') return { ticket: null, error: '' }
  const q = new URLSearchParams(window.location.search)
  const code = q.get('vk_error')
  return { ticket: q.get('vk_ticket'), error: code ? (VK_ERRORS[code] || VK_FAIL) : '' }
}

export default function Login() {
  const { signIn, signInWithYandex, signInWithVk, finishVkLogin, user } = useAuth()
  const [vk] = useState(vkFromUrl)
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() => oauthErrorFromUrl() || vk.error)
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
  // true, пока в адресе одноразовый ?code=… от Яндекса и клиент меняет его на сессию
  const [returning, setReturning] = useState(() => typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('code') || !!vk.ticket))

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

  // Возврат с ВК: билет из адреса → сессия. Адрес сразу чистим — билет
  // одноразовый по смыслу, в истории браузера ему делать нечего. Ref — от
  // двойного запуска эффекта в StrictMode (второй раз n в sessionStorage уже нет).
  const vkDone = useRef(false)
  useEffect(() => {
    if (!vk.ticket && !vk.error) return
    window.history.replaceState(null, '', '/login')
    if (!vk.ticket || vkDone.current) return
    vkDone.current = true
    finishVkLogin(vk.ticket).then(({ error: err }) => {
      if (err) { setReturning(false); setError(VK_FAIL) }
      // при успехе user появится в контексте, и эффект выше уведёт в /app
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const vkLogin = async () => {
    setError('')
    setLoading(true)
    const { error: err } = await signInWithVk()
    if (err) { setLoading(false); setError('Не удалось открыть вход через ВКонтакте. Проверьте связь.') }
  }

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

        <div className="auth-or">или войти через</div>
        <div className="auth-ext">
          <button type="button" className="auth-ext__btn auth-ext__btn--ya" disabled={loading} onClick={yandex}>
            Яндекс
          </button>
          <button type="button" className="auth-ext__btn auth-ext__btn--vk" disabled={loading} onClick={vkLogin}>
            ВКонтакте
          </button>
        </div>
        <p className="auth-note">
          Первый вход создаёт учётную запись — попросим <Link to="/consent" target="_blank">согласие на обработку данных</Link>.
        </p>

        <p className="auth-switch">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </main>
  )
}
