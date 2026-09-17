/* ============================================================
   archiveData.js — разбор данных для темы «Архив».
   ------------------------------------------------------------
   Тема показывает больше полей, чем парсер отчёта
   (raschet/raschetData.js): фракцию, габариты, достоверность,
   доверительный интервал. Ни одно из них не выдумывается —
   если пайплайн такую строку не прислал, поле остаётся `null`
   и в вёрстке рисуется прочерком. Это измерительный прибор:
   правдоподобное число здесь хуже пустой ячейки.
   ============================================================ */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const grab = (text, re) => {
  const m = String(text || '').match(re)
  return m ? m[1] : null
}

/* Фракция обычно едет хвостом самого материала: «Щебень 5–20»,
   «Щебень, фракция 20-40». Вынимаем диапазон и чистим название. */
export function splitMaterial(material) {
  if (!material) return { name: null, fraction: null }
  const m = String(material).match(/(\d+\s*[–—-]\s*\d+)\s*$/u)
  if (!m) return { name: String(material).trim(), fraction: null }
  const name = String(material).slice(0, m.index)
    .replace(/[,\s]*(фракци[яи])?[,\s]*$/iu, '')
    .trim()
  return { name: name || String(material).trim(), fraction: m[1].replace(/\s+/g, '') }
}

/** Габариты / площадь / высота / достоверность / интервал — если пайплайн их прислал. */
export function extraMetrics(result) {
  const s = String(result || '')

  const baseArea = num(grab(s, /Площадь\s+основани[яю]:?\s*([\d.,]+)/iu))
  const height   = num(grab(s, /(?:Высота|Макс\.?\s*высота)(?:\s+кучи)?:?\s*([\d.,]+)/iu))

  // «Габариты: 12.42 × 8.31 × 3.17» (× или x, любые пробелы)
  let dims = null
  const d = s.match(
    /(?:Габариты|Размеры|Д\s*[·x×]\s*Ш\s*[·x×]\s*В):?\s*([\d.,]+)\s*[x×·]\s*([\d.,]+)\s*[x×·]\s*([\d.,]+)/iu,
  )
  if (d) dims = [num(d[1]), num(d[2]), num(d[3])]

  let confidence = num(grab(s, /Достоверность:?\s*([\d.,]+)/iu))
  if (confidence == null) confidence = num(grab(s, /\bconf[:=]\s*([\d.,]+)/i))
  if (confidence != null && confidence > 1) confidence = confidence / 100

  // «Интервал 95%: 152.7 — 188.3 т»
  let interval = null
  const iv = s.match(/Интервал[^:]*:?\s*([\d.,]+)\s*[–—-]\s*([\d.,]+)/iu)
  if (iv) interval = [num(iv[1]), num(iv[2])]

  return { baseArea, height, dims, confidence, interval }
}

/* Нашёлся ли калибровочный куб. Прямого флага в ответе нет, но
   косвенный признак железный: метрический объём DUSt3R существует
   ТОЛЬКО когда масштаб снят с куба. Нет объёма — куб не отработал.
   Возвращаем true / false / null (ещё не считали). */
export function cubeResolved(result, volumeNum) {
  const s = String(result || '')
  if (!s) return null
  if (/куб[^\n.]{0,40}(не\s+найден|не\s+обнаружен|отсутств)/iu.test(s)) return false
  if (volumeNum != null) return true
  return false
}

/* Номер анализа в «архивном» виде: 8167-Д9.
   Считается из uuid замера — детерминированно, без латиницы
   (hex a–f → А–Е), поэтому у одного замера он всегда один и тот же. */
const HEX_RU = { a: 'А', b: 'Б', c: 'В', d: 'Д', e: 'Е', f: 'Ж' }
export function analysisNo(id) {
  if (!id) return null
  const hex = String(id).replace(/[^0-9a-f]/gi, '').toLowerCase()
  if (hex.length < 6) return null
  const ru = Array.from(hex.slice(0, 6))
    .map((ch) => HEX_RU[ch] || ch)
    .join('')
  return `${ru.slice(0, 4)}-${ru.slice(4, 6)}`.toUpperCase()
}

/* Прочерк — единственный допустимый вид «данных нет» в этой теме. */
export const DASH = '—'
