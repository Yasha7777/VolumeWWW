import { api } from '../api'
import { idb } from './db'

const MAX_ATTEMPTS = 4   // потолок для «жёстких» отказов (сервер ответил ошибкой)

// id-ы, по которым прямо сейчас летит POST из ЭТОЙ вкладки. Нужен потому,
// что проверка `status === 'sending'` в flushItem — это check-then-act через
// await idb.get(): два почти одновременных вызова (runAnalysis + flushAll по
// событию online/visibility, подхвативший ещё 'queued'-элемент) оба успевают
// прочитать 'queued' до того, как первый запишет 'sending', и делают два POST.
// Синхронный Set закрывает это окно без гонок. Кросс-вкладочные/сетевые
// повторы добивает идемпотентность на бэке (client_id).
const inFlight = new Set()

// ─── pub/sub: держим Analyze/History в курсе изменений очереди ───────────────
const listeners = new Set()
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const notifyLocal = () => listeners.forEach(fn => { try { fn() } catch {} })

let channel = null
try { channel = new BroadcastChannel('kb-queue'); channel.onmessage = () => notifyLocal() } catch {}
function emit() { notifyLocal(); try { channel?.postMessage('changed') } catch {} }

// ─── низкоуровневое ──────────────────────────────────────────────────────────
async function update(id, patch) {
  const item = await idb.get(id)
  if (!item) return null
  const next = { ...item, ...patch }
  await idb.put(next); emit(); return next
}
export const listQueue = () => idb.getAll()
export async function removeItem(id) { await idb.delete(id); emit() }

// ─── добавление (photos: [{ blob, name, exif }]) ─────────────────────────────
export async function enqueue({ title, notes, isProd, photos, cube }) {
  const item = {
    id: crypto.randomUUID(),           // = будущий id анализа (идемпотентность)
    title: title || '', notes: notes || '', isProd: !!isProd,
    cube: cube || null,                // блок параметров калибровочного куба
    photos, createdAt: new Date().toISOString(),
    status: 'queued', attempts: 0, lastError: null,
  }
  await idb.put(item); emit()
  maybeRegisterSync()                  // Phase 2 (Android); на iOS просто no-op
  return item.id
}

// ─── отправка одного элемента ────────────────────────────────────────────────
export async function flushItem(id) {
  if (inFlight.has(id)) return null    // этим таб-инстансом уже отправляется
  const item = await idb.get(id)
  if (!item || item.status === 'sending') return null

  inFlight.add(id)
  try {
    await update(id, { status: 'sending', lastError: null })

    const fd = new FormData()
    fd.append('client_id', item.id)    // ← бэк использует его как id анализа
    fd.append('title', item.title || 'Без названия')
    fd.append('notes', item.notes || '')
    fd.append('is_prod', item.isProd ? 'true' : 'false')
    item.photos.forEach(p => fd.append('files', p.blob, p.name || 'photo.jpg'))
    fd.append('exif_data', JSON.stringify(item.photos.map(p => p.exif ?? null)))
    fd.append('cube', JSON.stringify(item.cube ?? null))   // параметры калибровочного куба

    const res = await api.createAnalysis(fd)
    await idb.delete(id); emit()       // ушло — дальше в Истории ведёт серверная строка
    return res?.id ?? item.id
  } catch (err) {
    const offline = !navigator.onLine || err?.name === 'TypeError'
    if (offline) {
      await update(id, { status: 'queued', lastError: 'Нет сети' })   // не жёсткий отказ
    } else {
      const attempts = (item.attempts || 0) + 1
      await update(id, {
        status: attempts >= MAX_ATTEMPTS ? 'error' : 'queued',
        attempts, lastError: err?.message || 'Ошибка отправки',
      })
    }
    throw err
  } finally {
    inFlight.delete(id)
  }
}

// ─── флаш всей очереди (по триггерам сети/видимости) ─────────────────────────
let flushing = false
export async function flushAll() {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    const items = await idb.getAll()
    for (const it of items) {
      if (it.status !== 'queued') continue
      if (inFlight.has(it.id)) continue        // уже летит (напр. из runAnalysis)
      if (!navigator.onLine) break
      try { await flushItem(it.id) } catch { if (!navigator.onLine) break } // офлайн→стоп; жёсткая→дальше
    }
  } finally { flushing = false }
}

export async function retryItem(id) {   // ручной повтор для «Ошибки отправки»
  await update(id, { status: 'queued', attempts: 0, lastError: null })
  return flushItem(id)
}

// ─── Phase 2: Background Sync (Android/Chromium) ─────────────────────────────
async function maybeRegisterSync() {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.ready
    if ('sync' in reg) await reg.sync.register('kb-flush-queue')
  } catch {}
}

// ─── инициализация из main.jsx ───────────────────────────────────────────────
let inited = false
export function initQueue() {
  if (inited) return
  inited = true
  navigator.storage?.persist?.().catch(() => {})   // не дать браузеру выселить очередь
  window.addEventListener('online', flushAll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushAll() })
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data === 'kb-flush') flushAll() })
  }
  flushAll()
}
