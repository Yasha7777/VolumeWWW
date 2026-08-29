import { supabase } from './supabase'

/* ============================================================
   api.js — все вызовы к /api/*.
   ------------------------------------------------------------
   Слой рассчитан на мобильную сеть, а не на офисный Wi-Fi:

   • ТАЙМАУТ. У fetch его нет. Зависший запрос на LTE ждёт вечно —
     страница выглядит сломанной. Режем по REQ_TIMEOUT_MS.
   • РЕТРАЙ — только для идемпотентных методов (GET/HEAD) и только
     когда ответа не было (сеть/таймаут) либо пришло 5xx. POST/PUT/DELETE
     не повторяем: повторный rerun запустил бы пайплайн дважды.
     Исключение — загрузка замера: у неё идемпотентность по client_id
     на бэке, и повтор там безопасен (см. queue.js).
   • 401 → один прозрачный refresh токена и повтор запроса. На мобиле
     access-токен постоянно протухает в момент, когда сеть только что
     вернулась; без этого пользователь ловил «Токен истёк» на ровном месте.
   • ЗАГРУЗКА ФОТО идёт через XHR, а не fetch: только XHR даёт РЕАЛЬНЫЙ
     прогресс отправки байтов (upload.onprogress). fetch про отправку не
     сообщает ничего, поэтому раньше полоса на экране жила своей жизнью.
   ============================================================ */

const REQ_TIMEOUT_MS = 30000
const REQ_RETRIES    = 2

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Ошибка сети/таймаута — отличаем её от ответа сервера с ошибкой:
// на неё очередь реагирует «оставить в queued», а не «жёсткий отказ».
export class NetworkError extends Error {
  constructor(msg = 'Нет связи с сервером. Проверьте интернет.') {
    super(msg)
    this.name = 'NetworkError'
    this.isNetwork = true
  }
}

async function getToken({ forceRefresh = false } = {}) {
  try {
    if (forceRefresh) {
      const { data } = await supabase.auth.refreshSession()
      if (data?.session?.access_token) return data.session.access_token
    }
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

async function fetchWithTimeout(url, options, timeout) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function req(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase()
  const idempotent = method === 'GET' || method === 'HEAD'

  let token = await getToken()
  let refreshed = false

  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetchWithTimeout('/api' + path, {
        ...options,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {}),
        },
      }, REQ_TIMEOUT_MS)
    } catch (err) {
      // Сюда попадают и обрыв связи, и наш таймаут (AbortError).
      if (idempotent && attempt < REQ_RETRIES) {
        await sleep(600 * (attempt + 1))
        continue
      }
      throw new NetworkError()
    }

    // Токен протух — обновляем один раз и повторяем ЛЮБОЙ метод:
    // запрос до сервера дошёл, но выполнен не был, дублей не будет.
    if (res.status === 401 && !refreshed) {
      refreshed = true
      token = await getToken({ forceRefresh: true })
      continue
    }

    if (res.status >= 500 && idempotent && attempt < REQ_RETRIES) {
      await sleep(600 * (attempt + 1))
      continue
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail ?? 'Ошибка сервера')
    }
    return res.json()
  }
}

/* ── Загрузка замера с настоящим прогрессом отправки ──────────────────────
   onProgress({ phase, loaded, total, pct }):
     phase 'upload' — байты уходят на сервер, pct — реальный процент;
     phase 'server' — всё отправлено, сервер раскладывает фото в Storage;
                      сколько это займёт, браузер не знает → индикатор
                      переходит в неопределённое состояние, а не врёт
                      процентами.
   Таймаута нет намеренно: пачка до 100 оригиналов на мобильном интернете
   может грузиться десятки минут, и обрывать её по часам нельзя.          */
function uploadOnce(formData, { onProgress, token }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/analyses/')
    xhr.responseType = 'text'
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return
      onProgress({
        phase: 'upload',
        loaded: e.loaded,
        total: e.total,
        pct: e.total ? Math.min(99, Math.round((e.loaded / e.total) * 100)) : 0,
      })
    }
    xhr.upload.onload = () => {
      onProgress?.({ phase: 'server', loaded: 1, total: 1, pct: 100 })
    }

    xhr.onload = () => {
      let body = null
      try { body = JSON.parse(xhr.responseText || 'null') } catch {}
      if (xhr.status >= 200 && xhr.status < 300) { resolve({ ok: true, body }); return }
      resolve({ ok: false, status: xhr.status, body })
    }
    xhr.onerror   = () => reject(new NetworkError())
    xhr.ontimeout = () => reject(new NetworkError('Сервер не ответил вовремя.'))
    xhr.onabort   = () => reject(new NetworkError('Загрузка прервана.'))

    xhr.send(formData)
  })
}

async function createAnalysis(formData, { onProgress } = {}) {
  let token = await getToken()
  let res = await uploadOnce(formData, { onProgress, token })

  if (!res.ok && res.status === 401) {
    // Токен протух за время долгой заливки — обновляем и шлём заново.
    // Дублей не будет: бэкенд идемпотентен по client_id.
    token = await getToken({ forceRefresh: true })
    onProgress?.({ phase: 'upload', loaded: 0, total: 1, pct: 0 })
    res = await uploadOnce(formData, { onProgress, token })
  }

  if (!res.ok) throw new Error(res.body?.detail ?? 'Ошибка сервера')
  return res.body
}

export const api = {
  // ─── Profile ─────────────────────────────────────────────
  getProfile: () => req('/profile/'),

  updateProfile: (data) =>
    req('/profile/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // ─── Analyses ────────────────────────────────────────────
  createAnalysis,

  getAnalysis: (id) => req(`/analyses/${id}`),

  // userId — только для суперадмина: uuid пользователя или 'all'.
  // Обычный пользователь параметр не передаёт (и бэкенд его игнорирует).
  listAnalyses: (userId) =>
    req(`/analyses/${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`),

  deleteAnalysis: (id) => req(`/analyses/${id}`, { method: 'DELETE' }),

  // Повторный прогон существующего замера: бэкенд сам достаёт фото из Storage
  // и заново дёргает n8n (TEST или PROD — по isProd). Прежний результат
  // затирается, статус возвращается в pending.
  rerunAnalysis: (id, { isProd = false, cube = null } = {}) =>
    req(`/analyses/${id}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_prod: !!isProd, cube }),
    }),

  // ─── Admin (суперадмин) ──────────────────────────────────
  // 200 + список профилей — ты админ; 403 — обычный пользователь.
  adminListUsers: () => req('/analyses/admin/users'),
}
