import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

/* ============================================================
   AuthContext — состояние входа.
   ------------------------------------------------------------
   ГЛАВНЫЙ ИНВАРИАНТ: сетевой сбой — НЕ разлогин.

   Было: `onAuthStateChange((_, session) => setUser(session?.user ?? null))`
   плюс один getSession() без обработки ошибки. На мобильном интернете это
   и давало «выкидывает из аккаунта»:
     • getSession() у истёкшего access-токена ходит в сеть за refresh;
       на плохой связи он возвращает { session: null, error } — и мы
       ставили user = null → PrivateRoute уводил на /login;
     • любое событие с пустой сессией (в т.ч. промежуточное) тоже
       обнуляло пользователя.
   Refresh-токен при этом ЖИВОЙ: gotrue при сетевой ошибке сессию не
   стирает. То есть человека выкидывало на ровном месте.

   Стало: пользователя обнуляем ТОЛЬКО по явному SIGNED_OUT/USER_DELETED
   или когда сессии действительно нет в хранилище. Сетевой сбой →
   режим `degraded`: показываем последнего известного пользователя
   (кэш в localStorage) и молча пере-проверяемся при возврате сети,
   при возвращении на вкладку и по таймеру.

   ПРО «30 ДНЕЙ». Срок жизни входа задаётся не здесь, а в Supabase:
   refresh-токен по умолчанию бессрочный, ограничивают его
   Auth → Sessions (time-box / inactivity timeout) и JWT expiry.
   Код обязан лишь не терять токен и уметь его обновить — этим и
   занимаются authStorage.js (хранение) и supabase.js (сеть).
   ============================================================ */

const AuthContext = createContext(null)

// Кэш «кто вошёл» — только id/email, без токенов. Нужен, чтобы на плохой
// связи показать приложение, а не форму логина.
const CACHE_KEY = 'kb-last-user'
const readCache = () => {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
const writeCache = (u) => {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify({ id: u.id, email: u.email ?? '' }))
    else localStorage.removeItem(CACHE_KEY)
  } catch {}
}

// Пере-проверка сессии, пока мы в degraded, раз в минуту — на случай, если
// события online/visibilitychange не пришли (мобильные браузеры их зажимают).
const REVALIDATE_MS = 60000

// Сколько держим стартовый спиннер (PrivateRoute), ожидая ответа gotrue.
// Дальше пускаем в приложение по кэшу: у getSession() внутри свои таймаут и
// ретраи (supabase.js), суммарно до минуты, и всё это время экран был бы пустым.
const INITIAL_WAIT_MS = 5000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // true — пользователь взят из кэша, сеть сессию ещё не подтвердила.
  const [degraded, setDegraded] = useState(false)

  const degradedRef = useRef(false)
  const setDegradedBoth = useCallback((v) => { degradedRef.current = v; setDegraded(v) }, [])

  useEffect(() => {
    let alive = true

    const accept = (u) => {
      if (!alive) return
      setUser(u); writeCache(u); setDegradedBoth(false)
    }
    const dropOut = () => {
      if (!alive) return
      setUser(null); writeCache(null); setDegradedBoth(false)
    }
    const fallbackToCache = () => {
      if (!alive) return
      const cached = readCache()
      setUser(cached)
      setDegradedBoth(!!cached)
    }

    // Первичное определение: сессия из хранилища (+ refresh, если протухла).
    // Ответ дожидаемся до конца, но спиннер снимаем максимум через
    // INITIAL_WAIT_MS — приложение открывается по кэшу, а настоящий вердикт
    // догоняет и при необходимости уводит на /login.
    let answered = false     // ставится синхронно в обработчиках getSession
    const settled = supabase.auth.getSession().then(
      ({ data, error }) => {
        answered = true
        if (!alive) return
        if (data?.session?.user) accept(data.session.user)
        else if (error) fallbackToCache()   // сеть/таймаут — держим вход
        else dropOut()                       // сессии нет по-настоящему
      },
      () => { answered = true; fallbackToCache() },
    )

    ;(async () => {
      await Promise.race([settled, new Promise(r => setTimeout(r, INITIAL_WAIT_MS))])
      if (!alive) return
      // Ответа ещё нет — показываем последнего известного пользователя,
      // иначе человек увидит форму входа зря. Вердикт догонит и поправит.
      if (!answered) fallbackToCache()
      setLoading(false)
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) { accept(session.user); return }
      // Пустая сессия засчитывается за выход только если это явный выход.
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') dropOut()
    })

    // ─ Пере-проверка: сеть вернулась / вкладка снова видима / по таймеру ─
    const revalidate = async () => {
      if (!degradedRef.current) return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      try {
        const { data } = await supabase.auth.refreshSession()
        if (data?.session?.user) accept(data.session.user)
      } catch {}
    }
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate() }

    window.addEventListener('online', revalidate)
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(revalidate, REVALIDATE_MS)

    return () => {
      alive = false
      subscription.unsubscribe()
      window.removeEventListener('online', revalidate)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(tick)
    }
  }, [setDegradedBoth])

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signUp = (email, password) =>
    supabase.auth.signUp({ email, password })

  // Явный выход чистим сразу и локально: если signOut не долетел до сервера
  // (нет сети), пользователь всё равно должен увидеть форму входа.
  const signOut = async () => {
    writeCache(null)
    setUser(null)
    setDegradedBoth(false)
    try { return await supabase.auth.signOut() } catch (error) { return { error } }
  }

  return (
    <AuthContext.Provider value={{ user, loading, degraded, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
