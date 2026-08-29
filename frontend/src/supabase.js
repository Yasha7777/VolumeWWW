import { createClient } from '@supabase/supabase-js'
import { authStorage } from './authStorage'

/* ============================================================
   supabase.js — anon-клиент (только auth, БД фронт не трогает).
   ------------------------------------------------------------
   ПОЧЕМУ ЗДЕСЬ НЕ ДЕФОЛТНЫЙ createClient.

   1) fetch с таймаутом и ретраями. У браузерного fetch таймаута НЕТ.
      На мобильной сети запрос к /auth/v1/token нередко не падает, а
      ВИСИТ (переход LTE↔Wi-Fi, лифт, edge). Всё, что ждёт токен,
      висит вместе с ним: getSession() не резолвится → AuthContext
      сидит в loading → «сайт не работает вообще». Таймаут превращает
      зависание в обычную ошибку, ретрай переживает короткий провал.

      Ретраим ТОЛЬКО когда ответа не было (сеть/таймаут). Обновление
      токена при этом безопасно: gotrue держит refresh token reuse
      interval, и повтор в пределах пары секунд вернёт ту же пару.

   2) storage: authStorage — localStorage + зеркало в IndexedDB,
      см. authStorage.js. Дефолтный localStorage на телефоне выселяется
      и роняет refresh-токен, а с ним и «тридцатидневный» вход.

   storageKey НЕ переопределяем: у него дефолт sb-<ref>-auth-token,
   и смена ключа = разлогин всех живых сессий.
   ============================================================ */

const AUTH_TIMEOUT_MS = 20000   // потолок ожидания ответа gotrue
const AUTH_RETRIES    = 2       // + первая попытка = до 3 заходов

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function resilientFetch(input, init = {}) {
  let lastErr
  for (let attempt = 0; attempt <= AUTH_RETRIES; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), AUTH_TIMEOUT_MS)
    const onOuterAbort = () => ctl.abort()
    init.signal?.addEventListener('abort', onOuterAbort)
    try {
      return await fetch(input, { ...init, signal: ctl.signal })
    } catch (err) {
      lastErr = err
      // Отменил вызывающий (не наш таймаут) — уважаем, не ретраим.
      if (init.signal?.aborted) throw err
      if (attempt < AUTH_RETRIES) await sleep(400 * (attempt + 1) + Math.random() * 200)
    } finally {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onOuterAbort)
    }
  }
  throw lastErr
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,   // нужен для ссылок подтверждения почты
    },
    global: { fetch: resilientFetch },
  },
)
