import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { consentMeta, markConsentPending } from '../legal/consent'

const NEED_CONSENT = 'Отметьте согласие на обработку персональных данных и с Пользовательским соглашением'

export default function Register() {
  const { signUp, signInWithYandex, signInWithVk } = useAuth()
  const navigate = useNavigate()
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [consent, setConsent] = useState(false)
  
  // PRO-фича: состояние для переключения видимости пароля
  const [showPassword, setShowPassword] = useState(false) 
  
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // Поля с ошибкой: { email?, password?, password2?, consent? } — текст под
  // полем. Подсвечиваются ВСЕ сразу (styles.css, .is-invalid), а не первое
  // попавшееся: человек видит всё, что нужно поправить, за один раз.
  const [bad, setBad] = useState({})
  const refs = { email: useRef(null), password: useRef(null), password2: useRef(null), consent: useRef(null) }
  const clearBad = (key) => { if (bad[key]) setBad((b) => { const n = { ...b }; delete n[key]; return n }) }

  // Универсальный обработчик для полей: обновляет значение и сразу гасит ошибку
  const handleInput = (setter, key) => (e) => {
    setter(e.target.value)
    clearBad(key)
    if (error) setError('')
  }

  // Обработчик для чекбокса: тоже гасит ошибку при клике
  const handleConsent = (e) => {
    setConsent(e.target.checked)
    clearBad('consent')
    if (error) setError('')
  }

  // Показать ошибки и поставить курсор в первое поле с ошибкой (по порядку формы)
  const reject = (b) => {
    setBad(b)
    const first = ['email', 'password', 'password2', 'consent'].find((k) => b[k])
    if (first) refs[first].current?.focus()
    return !!first
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    // Валидация — собираем все ошибки разом
    const b = {}
    if (!email.trim()) b.email = 'Введите адрес электронной почты'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) b.email = 'Адрес почты указан с ошибкой'
    if (!password) b.password = 'Придумайте пароль'
    else if (password.length < 6) b.password = 'Пароль должен быть не короче 6 символов'
    if (!password2) b.password2 = 'Повторите пароль'
    else if (password && password !== password2) b.password2 = 'Пароли не совпадают'
    if (!consent) b.consent = NEED_CONSENT
    if (reject(b)) return

    setLoading(true)
    // отметка о согласии (редакция + время) уезжает вместе с учётной записью
    const { data, error: err } = await signUp(email, password, consentMeta())
    setLoading(false)
    
    if (err) {
      setError(err.message)
    } else if (data?.session) {
      // Подтверждение почты на сервере выключено — учётная запись уже рабочая
      // и вход выполнен. Экран «проверьте почту» здесь был бы неправдой:
      // письма никто не отправлял.
      navigate('/app', { replace: true })
    } else {
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    }
  }

  // Регистрация через Яндекс или ВКонтакте: согласие нужно ДО ухода туда — учётная
  // запись создаётся на возврате, без этой формы. Отметку переносит
  // markConsentPending (подхватит ConsentGate после входа).
  const external = (start, label) => async () => {
    setError('')
    // для входа через внешний сервис из всей формы нужно только согласие
    if (reject(consent ? {} : { consent: NEED_CONSENT })) return
    markConsentPending()
    setLoading(true)
    const { error: err } = await start()
    if (err) { setLoading(false); setError(`Не удалось открыть вход через ${label}. Проверьте связь.`) }
  }
  const yandex = external(signInWithYandex, 'Яндекс')
  const vkLogin = external(signInWithVk, 'ВКонтакте')

  if (done) return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ textAlign:'center' }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
            </svg>
          </div>
        </div>
        <h1 className="auth-h1">Проверьте почту</h1>
        <p className="auth-sub">Мы отправили письмо с подтверждением на <strong>{email}</strong>.<br/>После подтверждения вы сможете войти.</p>
      </div>
    </main>
  )

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

        <h1 className="auth-h1">Создать аккаунт</h1>
        <p className="auth-sub">Карелия Строй — ИИ-анализ материалов</p>

        <form onSubmit={submit} noValidate>
          <div className={`auth-field${bad.email ? ' is-invalid' : ''}`}>
            <label htmlFor="reg-email">Эл. почта</label>
            <input
              id="reg-email" ref={refs.email}
              type="email" required autoFocus autoComplete="email"
              value={email} onChange={handleInput(setEmail, 'email')}
              placeholder="you@company.ru"
              disabled={loading} // Блокируем при отправке
              aria-invalid={!!bad.email}
            />
            {bad.email && <div className="auth-field__err" role="alert">{bad.email}</div>}
          </div>

          <div className={`auth-field${bad.password ? ' is-invalid' : ''}`} style={{ position: 'relative' }}>
            <label htmlFor="reg-password">Пароль</label>
            <input
              id="reg-password" ref={refs.password}
              type={showPassword ? "text" : "password"} 
              required autoComplete="new-password"
              value={password} onChange={handleInput(setPassword, 'password')}
              aria-invalid={!!bad.password}
              placeholder="минимум 6 символов"
              disabled={loading}
              style={{ paddingRight: 40 }} // Оставляем место справа, чтобы текст не залезал под иконку
            />
            {/* Кнопка Глазика */}
            <button
              type="button"
              tabIndex="-1" // Чтобы не ловить фокус при навигации через Tab
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute', right: 12, top: 34,
                background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', color: 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              {showPassword ? (
                // Иконка "Глаз перечеркнут" (Скрыть)
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>
              ) : (
                // Иконка "Глаз" (Показать)
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
            {bad.password && <div className="auth-field__err" role="alert">{bad.password}</div>}
          </div>

          <div className={`auth-field${bad.password2 ? ' is-invalid' : ''}`}>
            <label htmlFor="reg-password2">Повторите пароль</label>
            <input
              id="reg-password2" ref={refs.password2}
              type={showPassword ? "text" : "password"} 
              required autoComplete="new-password"
              value={password2} onChange={handleInput(setPassword2, 'password2')}
              placeholder="••••••••"
              disabled={loading}
              aria-invalid={!!bad.password2}
            />
            {bad.password2 && <div className="auth-field__err" role="alert">{bad.password2}</div>}
          </div>

          <div className={`auth-consent${bad.consent ? ' is-invalid' : ''}`}>
            <input 
              type="checkbox" id="consent" ref={refs.consent}
              aria-invalid={!!bad.consent}
              checked={consent} onChange={handleConsent}
              disabled={loading}
              style={{ 
                width: 18, height: 18, minWidth: 18, minHeight: 18,
                margin: '3px 0 0 0', padding: 0, 
                cursor: loading ? 'default' : 'pointer',
                accentColor: 'var(--green)'
              }}
            />
            <label htmlFor="consent" style={{ 
              fontSize: 13, lineHeight: 1.4, color: 'var(--muted)', 
              cursor: loading ? 'default' : 'pointer', fontWeight: 'normal', textTransform: 'none' 
            }}>
              {/* 152-ФЗ (ред. с 01.09.2025): согласие — отдельный документ, а не
                  «согласен с политикой». Поэтому ссылка ведёт на /consent, а
                  политика и соглашение — рядом, каждая своим адресом.
                  Цвет ссылок — токен: '#243816' хардкодом в тёмной теме
                  читался как чёрное на чёрном. */}
              Я даю{' '}
              <Link to="/consent" target="_blank" style={{ color: 'var(--text)', textDecoration: 'underline', fontWeight: '500' }}>
                согласие на обработку персональных данных
              </Link>{' '}
              и принимаю{' '}
              <Link to="/terms" target="_blank" style={{ color: 'var(--text)', textDecoration: 'underline', fontWeight: '500' }}>
                Пользовательское соглашение
              </Link>
              . С{' '}
              <Link to="/privacy" target="_blank" style={{ color: 'var(--text)', textDecoration: 'underline', fontWeight: '500' }}>
                Политикой обработки персональных данных
              </Link>{' '}
              ознакомлен(а).
            </label>
          </div>
          {bad.consent && <div className="auth-consent__err" role="alert">{bad.consent}</div>}

          {/* Плавающий блок ошибки */}
          {error && <div className="auth-err" style={{ marginTop: 12 }}>{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading} style={{ marginTop: 16 }}>
            {loading ? <><div className="spinner" /> Регистрируем...</> : 'Зарегистрироваться'}
          </button>
        </form>

        <div className="auth-or">или через</div>
        <div className="auth-ext">
          <button type="button" className="auth-ext__btn auth-ext__btn--ya" disabled={loading} onClick={yandex}>
            <span className="auth-ext__dot" aria-hidden="true" />Яндекс
          </button>
          <button type="button" className="auth-ext__btn auth-ext__btn--vk" disabled={loading} onClick={vkLogin}>
            <span className="auth-ext__dot" aria-hidden="true" />ВКонтакте
          </button>
        </div>
        <p className="auth-note">Согласие выше нужно и для этих способов.</p>

        <p className="auth-switch">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </main>
  )
}
