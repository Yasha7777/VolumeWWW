/* ============================================================
   authStorage.js — хранилище сессии Supabase, устойчивое к мобиле.
   ------------------------------------------------------------
   ЗАЧЕМ. Дефолт supabase-js — чистый localStorage. На телефоне это
   слабое место сразу с двух сторон:
     • localStorage выселяется агрессивнее прочего (iOS ITP чистит
       script-writable storage у сайтов без «частого» использования),
       а вместе с ним улетает refresh-токен → пользователь на входе
       видит форму логина, хотя ничего не делал;
     • запись может бросить (приватный режим Safari, переполненная
       квота) — supabase проглотит ошибку, сессия не сохранится, и
       после перезагрузки вкладки её уже нет.

   ЧТО ДЕЛАЕМ. Три уровня, читаем сверху вниз, пишем во все:
     1) память процесса  — переживает сбой обоих хранилищ в рамках вкладки;
     2) localStorage     — синхронный быстрый путь (как было);
     3) IndexedDB        — зеркало. Живёт под тем же
        `navigator.storage.persist()`, что и офлайн-очередь (queue.js),
        и восстанавливает сессию, если localStorage вычистили.

   ИНВАРИАНТ: ключ хранения НЕ меняем (у supabase он
   `sb-<project-ref>-auth-token`) — иначе все текущие сессии
   разом стали бы «чужими» и это выглядело бы как массовый разлогин.
   ============================================================ */

const DB_NAME = 'kb-auth'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise = null
function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function idbRun(mode, action) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const request = action(t.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

const mem = new Map()
// Что уже лежит в зеркале — чтобы не писать в IndexedDB на каждое чтение
// (supabase дёргает getItem часто: перед каждым запросом за токеном).
const mirrored = new Map()

function mirror(key, value) {
  if (mirrored.get(key) === value) return
  mirrored.set(key, value)
  idbRun('readwrite', s => s.put({ key, value })).catch(() => {})
}

export const authStorage = {
  async getItem(key) {
    try {
      const v = localStorage.getItem(key)
      if (v != null) { mem.set(key, v); mirror(key, v); return v }
    } catch {}

    if (mem.has(key)) return mem.get(key)

    // localStorage пуст — пробуем зеркало и заодно чиним localStorage.
    try {
      const row = await idbRun('readonly', s => s.get(key))
      if (row?.value != null) {
        mem.set(key, row.value)
        mirrored.set(key, row.value)
        try { localStorage.setItem(key, row.value) } catch {}
        return row.value
      }
    } catch {}

    return null
  },

  async setItem(key, value) {
    mem.set(key, value)
    try { localStorage.setItem(key, value) } catch {}
    mirror(key, value)
  },

  async removeItem(key) {
    mem.delete(key)
    mirrored.delete(key)
    try { localStorage.removeItem(key) } catch {}
    try { await idbRun('readwrite', s => s.delete(key)) } catch {}
  },
}
