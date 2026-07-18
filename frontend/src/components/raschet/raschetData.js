/* ============================================================
   raschetData.js — парсер ответа n8n + сборка данных документа.
   ------------------------------------------------------------
   ЛЁГКИЙ модуль: НЕ импортирует @react-pdf/renderer.
   Его можно дёргать откуда угодно (Analyze, History, ReportPanel),
   не утаскивая PDF-движок (~1.3 МБ) в основной бандл.

   ИСТОЧНИК ДАННЫХ:
     • Объём      — из блока «3D-реконструкция (DUSt3R)».
     • Плотность  — «Плотность материала» (определяет ИИ / LLaVA).
     • Масса      — считаем САМИ: V(DUSt3R) × ρ(материала),
                    поэтому в отчёте всегда V × ρ = m.
   ============================================================ */

const num = (v) => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export const ruNum = (n, frac = 2) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: frac, maximumFractionDigits: frac })

export const ruInt = (n) => (n == null ? '—' : n.toLocaleString('ru-RU'))

/* Объём DUSt3R бывает мелким (0.0301 м³) — показываем больше знаков
   для малых значений, чтобы не терять точность до «0,03». */
export const fmtVol = (n) => {
  if (n == null) return '—'
  const frac = n >= 1 ? 2 : n >= 0.1 ? 3 : 4
  return ruNum(n, frac)
}

/* Масса: для малых значений (доли тонны) — 3 знака, иначе 2. */
export const fmtMass = (n) => {
  if (n == null) return '—'
  const frac = n >= 1 ? 2 : 3
  return ruNum(n, frac)
}

export function parseWebhookResult(raw) {
  const s = String(raw || '')
  const grab = (re) => { const m = s.match(re); return m ? m[1] : null }

  const frames = num(grab(/Проанализировано фото:\s*(\d+)/u))

  let material = grab(/Материал:\s*(.+)/u)
  if (material) {
    material = material.replace(/[*_`]/g, '').replace(/^[^\p{L}\d]+/u, '').trim()
    if (/^(неизвестн|unknown|n\/?a|нет данных|[—-])/iu.test(material)) material = null
  }

  // --- ОБЪЁМ: строго из блока DUSt3R («Объём DUSt3R: X м³») ---
  // Понимает и «м³», и «м3». Верхний «📦 Объём» (оценка из БД) не берём.
  const volumeNum = num(grab(/Объём\s+DUSt3R:\s*([\d.,]+)\s*м[³3]/u))

  // --- ПЛОТНОСТЬ: «Плотность материала: X кг/м³» (задаёт ИИ) ---
  const densityKg = num(grab(/Плотность\s+материала:\s*([\d.,]+)\s*кг\s*\/\s*м[³3]/u))

  // --- МАССА: считаем сами. V(м³) × ρ(кг/м³) = кг, /1000 → тонны ---
  let massT = null
  if (volumeNum != null && densityKg != null) {
    massT = (volumeNum * densityKg) / 1000
  }
  const massKg = massT != null ? massT * 1000 : null

  const glbUrl = grab(/(https?:\/\/\S+\.glb)/i)

  return {
    framesUsed: frames,
    material,
    volume: fmtVol(volumeNum),
    mass: fmtMass(massT),
    density: ruInt(densityKg),
    glbUrl,
    // сырые числа — на случай, если понадобятся выше по коду
    _volumeNum: volumeNum,
    _densityKg: densityKg,
    _massT: massT,
    _massKg: massKg,
  }
}

/* координаты + дата съёмки из EXIF первого фото, где они есть */
export function exifMeta(photos) {
  const p = (photos || []).find((x) => x && typeof x === 'object' && x.exifData)
  const ex = p?.exifData
  if (!ex) return {}
  const out = {}
  const lat = num(ex.latitude), lng = num(ex.longitude)
  if (lat != null && lng != null) out.coords = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  const dt = ex.DateTimeOriginal || ex.CreateDate || ex.ModifyDate
  if (dt) {
    const d = new Date(dt)
    if (!isNaN(d)) out.shotAt = d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  return out
}

/* ---------- Заглушка (если result не передан) ---------- */
export const STUB = {
  docNo: 'СМ-2026-06-892',
  object: 'Замер материала',
  coords: '—',
  address: '—',
  shotAt: '—',
  rows: [{ material: 'Не определён', volume: '—', density: '—', mass: '—' }],
  framesUsed: '—',
  glbUrl: null,
  photos: [null, null, null],
  photoCaptions: ['Кадр 1', 'Кадр 2', 'Кадр 3'],
  org: 'ООО «Карелия Строй»',
  inn: '1001623120',
  ogrn: '1231000000000',
  region: 'г. Петрозаводск, Республика Карелия',
  email: 'volumetric@gottland.ru',
  performer: 'DUSt3R',
}

/* генератор номера документа (один на анализ) */
export function makeDocNo() {
  const d = new Date()
  const seq = String(Date.now()).slice(-3)
  return `СМ-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${seq}`
}

/* собираем данные документа из result + photos + title */
export function buildDocData({ result, photos, title, docNo }) {
  const parsed = typeof result === 'string' ? parseWebhookResult(result)
    : (result && typeof result === 'object' ? result : {})

  const srcs = (photos || [])
    .map((x) => (typeof x === 'string' ? x : x?.dataUrl))
    .filter(Boolean).slice(0, 3)

  const meta = exifMeta(photos)
  const dateMade = new Date().toLocaleDateString('ru-RU')

  const photoArr = srcs.length ? srcs : STUB.photos
  const captions = photoArr.map((_, i) => `Кадр ${i + 1}`)

  return {
    ...STUB,
    docNo: docNo || STUB.docNo,
    dateMade,
    object: title || parsed.material || STUB.object,
    coords: meta.coords || STUB.coords,
    address: STUB.address,
    shotAt: meta.shotAt || STUB.shotAt,
    rows: [{
      material: parsed.material || 'Не определён',
      volume: parsed.volume ?? '—',
      density: parsed.density ?? '—',
      mass: parsed.mass ?? '—',
    }],
    framesUsed: parsed.framesUsed ?? (photos?.length || STUB.framesUsed),
    glbUrl: parsed.glbUrl || null,
    photos: photoArr,
    photoCaptions: captions,
  }
}
