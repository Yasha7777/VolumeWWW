import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { signUp } = useAuth()
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

  // Универсальный обработчик для полей: обновляет значение и сразу гасит ошибку
  const handleInput = (setter) => (e) => {
    setter(e.target.value)
    if (error) setError('')
  }

  // Обработчик для чекбокса: тоже гасит ошибку при клике
  const handleConsent = (e) => {
    setConsent(e.target.checked)
    if (error) setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    // Валидация
    if (password !== password2) { 
      setError('Пароли не совпадают')
      return 
    }
    if (password.length < 6) { 
      setError('Пароль должен быть минимум 6 символов')
      return 
    }
    if (!consent) { 
      setError('Необходимо согласиться с Политикой конфиденциальности')
      return 
    }

    setLoading(true)
    const { error: err } = await signUp(email, password)
    setLoading(false)
    
    if (err) {
      setError(err.message)
    } else {
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    }
  }

  if (done) return (
    <div className="auth-wrap">
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
    </div>
  )

  return (
    <div className="auth-wrap">
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
        <p className="auth-sub">Карелия Строй — AI Анализ материалов</p>

        <form onSubmit={submit} noValidate>
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email" required autoFocus autoComplete="email"
              value={email} onChange={handleInput(setEmail)}
              placeholder="you@company.ru"
              disabled={loading} // Блокируем при отправке
            />
          </div>

          <div className="auth-field" style={{ position: 'relative' }}>
            <label>Пароль</label>
            <input
              type={showPassword ? "text" : "password"} 
              required autoComplete="new-password"
              value={password} onChange={handleInput(setPassword)}
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
          </div>

          <div className="auth-field">
            <label>Повторите пароль</label>
            <input
              type={showPassword ? "text" : "password"} 
              required autoComplete="new-password"
              value={password2} onChange={handleInput(setPassword2)}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>

          <div style={{ 
            display: 'flex', alignItems: 'flex-start', gap: 12, 
            marginTop: 20, marginBottom: 4, textAlign: 'left'
          }}>
            <input 
              type="checkbox" id="consent" 
              checked={consent} onChange={handleConsent}
              disabled={loading}
              style={{ 
                width: 18, height: 18, minWidth: 18, minHeight: 18,
                margin: '3px 0 0 0', padding: 0, 
                cursor: loading ? 'default' : 'pointer',
                accentColor: '#243816'
              }}
            />
            <label htmlFor="consent" style={{ 
              fontSize: 13, lineHeight: 1.4, color: 'var(--muted)', 
              cursor: loading ? 'default' : 'pointer', fontWeight: 'normal', textTransform: 'none' 
            }}>
              Я даю согласие на обработку моих персональных данных в соответствии с{' '}
              <Link to="/privacy" target="_blank" style={{ color: '#243816', textDecoration: 'underline', fontWeight: '500' }}>
                Политикой конфиденциальности
              </Link>
            </label>
          </div>

          {/* Плавающий блок ошибки */}
          {error && <div className="auth-err" style={{ marginTop: 12 }}>{error}</div>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading} style={{ marginTop: 16 }}>
            {loading ? <><div className="spinner" /> Регистрируем...</> : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="auth-switch">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  )
}
