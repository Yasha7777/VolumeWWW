// Минимальная обёртка над IndexedDB для офлайн-очереди съёмок.
// Одно хранилище "items", ключ — client_id (UUID, он же будущий id анализа).
// В value лежат blob'ы фото — IndexedDB это умеет нативно.
const DB_NAME = 'kb-queue'
const DB_VERSION = 1
const STORE = 'items'

let dbPromise = null
function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function run(mode, action) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const request = action(t.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

export const idb = {
  put:    (item) => run('readwrite', s => s.put(item)),
  get:    (id)   => run('readonly',  s => s.get(id)),
  getAll: ()     => run('readonly',  s => s.getAll()),
  delete: (id)   => run('readwrite', s => s.delete(id)),
}
