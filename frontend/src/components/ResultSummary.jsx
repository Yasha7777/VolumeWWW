import { useState } from 'react'

/* ============================================================
   ResultSummary — сводка результата на странице «Анализ».
   ------------------------------------------------------------
   Те же четыре карточки, что в п. 2 PDF-отчёта: материал, объём,
   плотность, расчётная масса. Показывается ВСЕГДА, когда расчёт
   закончился: чего сервер не определил — там прочерк, а не
   пропавшая плашка. Раньше сводка появлялась только при найденном
   объёме или материале; без них страница вываливала сырой текст
   пайплайна, и главного — «что посчитано, а что нет» — видно не было.

   Сырой текст никуда не делся: он под «Технические данные».
   Стили — .rs* в styles.css.
   ============================================================ */

const DASH = '—'
const filled = (v) => v != null && v !== '' && v !== DASH

/* Короткое пояснение под карточками — почему стоят прочерки и можно ли
   верить цифре. Только то, что прямо следует из ответа сервера.
   Возвращает { flag, text } (любое поле может быть null). Чистая функция. */
export function summaryNote(parsed, result) {
  const p = parsed || {}
  const text = String(result || '')
  const noVolume = p._volumeNum == null
  const noDensity = p._densityKg == null
  const scaleBad = /ОБЪЁМ\s+НЕДОСТОВЕРЕН/iu.test(text) || /Масштаб[^\n]*недостовер/iu.test(text)

  if (noVolume) {
    return {
      flag: 'Объём не определён',
      text: scaleBad
        ? 'У модели нет надёжного масштаба, поэтому объём в м³ не посчитан. Без объёма нет и массы.'
        : 'Сервер не вернул объём. Без объёма нет и массы. Подробности — в технических данных.',
    }
  }
  if (scaleBad) {
    return {
      flag: 'Объём недостоверен',
      text: 'Масштаб модели не подтверждён: объём показан справочно.'
        + (noDensity ? ' Плотность не задана — масса не посчитана.' : ''),
    }
  }
  if (noDensity) {
    return { flag: null, text: 'Материал и плотность не заданы — масса не посчитана.' }
  }
  return { flag: null, text: null }
}

/* «Точек в облаке: 43 243» из текста ответа (если строка есть). */
export function cloudPoints(result) {
  // пробелы внутри числа — обычный, неразрывный и узкий неразрывный; перевод строки сюда не входит
  const m = String(result || '').match(/Точек в облаке:[ \t]*((?:\d[\d \u00a0\u202f]*)?\d)/u)
  return m ? m[1].replace(/[ \u00a0\u202f]+/gu, '\u00a0') : null
}

function Cell({ label, value, unit, accent, serif }) {
  const ok = filled(value)
  return (
    <div className={`rs-cell${accent ? ' rs-cell--accent' : ''}`}>
      <span>{label}</span>
      <b className={`${serif ? 'rs-mat' : ''}${ok ? '' : ' is-empty'}`}>
        {ok ? value : (serif ? 'Не определён' : DASH)}
        {unit && <i className="rs-unit">{unit}</i>}
      </b>
    </div>
  )
}

export default function ResultSummary({ parsed, result }) {
  const [showRaw, setShowRaw] = useState(false)
  const p = parsed || {}
  const note = summaryNote(p, result)
  const points = cloudPoints(result)
  const meta = [
    p.framesUsed != null ? `Исходных кадров: ${p.framesUsed}` : null,
    points ? `Точек в облаке: ${points}` : null,
  ].filter(Boolean)

  return (
    <div className="rs">
      {note.flag && <div className="rs-flag">{note.flag}</div>}

      <div className="rs-grid">
        <Cell label="Материал" value={p.material} serif />
        <Cell label="Объём" value={p.volume} unit="м³" />
        <Cell label="Плотность" value={p.density} unit="кг/м³" />
        <Cell label="Расчётная масса" value={p.mass} unit="т" accent />
      </div>

      {note.text && <div className="rs-note">{note.text}</div>}
      {meta.length > 0 && <div className="rs-meta">{meta.join(' · ')}</div>}

      {result && (
        <>
          <button
            type="button"
            className="rs-raw-toggle"
            aria-expanded={showRaw}
            onClick={() => setShowRaw((v) => !v)}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: showRaw ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
            {showRaw ? 'Скрыть технические данные' : 'Технические данные'}
          </button>
          {showRaw && <div className="rs-raw">{result}</div>}
        </>
      )}
    </div>
  )
}
