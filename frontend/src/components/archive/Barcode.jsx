import { useMemo } from 'react'

/* ============================================================
   Barcode — штрих-код темы «Архив».
   ------------------------------------------------------------
   По ТЗ код обязан РЕАЛЬНО кодировать строку, а не быть
   декоративной рябью: каждый символ → 8 бит ASCII, биты подряд
   → полосы (1 — тёмная, 0 — фон).

   Полосы рисуются одним linear-gradient с ПРОЦЕНТНЫМИ стопами,
   а не пиксельными: так код остаётся побитово верным на любой
   ширине — и в панели задач (узко), и в шапке архива (широко).
   Пиксельные стопы при резиновой ширине обрезали бы последние
   биты, и код переставал бы декодироваться.

   Проверка: у элемента есть data-bits с полной битовой строкой —
   её видно в инспекторе и можно сверить с ASCII вручную.
   ============================================================ */

export const STORAGE_KEY_TEXT = 'cicada 3301'

/** строка → битовая строка (8 бит ASCII на символ) */
export function toBits(text) {
  return Array.from(String(text))
    .map((ch) => ch.charCodeAt(0).toString(2).padStart(8, '0'))
    .join('')
}

/**
 * Битовая строка → CSS-градиент.
 * Соседние одинаковые биты сливаются в один стоп — полос в разметке
 * меньше, рисунок тот же.
 */
function bitsToGradient(bits, on, off) {
  const step = 100 / bits.length
  const stops = []
  let i = 0
  while (i < bits.length) {
    let j = i
    while (j < bits.length && bits[j] === bits[i]) j++
    const color = bits[i] === '1' ? on : off
    // округление до 4 знаков: иначе строка градиента раздувается втрое
    const from = (i * step).toFixed(4)
    const to   = (j * step).toFixed(4)
    stops.push(`${color} ${from}% ${to}%`)
    i = j
  }
  return `linear-gradient(90deg, ${stops.join(',')})`
}

export default function Barcode({
  text = STORAGE_KEY_TEXT,
  caption,                    // подпись под кодом; null — без подписи
  className = '',
}) {
  const bits = useMemo(() => toBits(text), [text])
  const bg   = useMemo(
    () => bitsToGradient(bits, 'var(--ink)', 'transparent'),
    [bits],
  )

  return (
    <div className={`arc-code ${className}`}>
      <div
        className="arc-code__bars"
        style={{ backgroundImage: bg }}
        data-bits={bits}
        aria-hidden="true"
      />
      {caption !== null && (
        <div className="arc-code__cap">
          {caption || `КОД ХРАНИЛИЩА · ${bits.length} БИТ · КЛЮЧ 3301`}
        </div>
      )}
    </div>
  )
}
