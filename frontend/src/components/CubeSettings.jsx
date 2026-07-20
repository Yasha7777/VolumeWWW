import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings, UserCog } from 'lucide-react'

// ─── Параметры калибровочного куба ───────────────────────────────────────────
// Только фронтенд: собирает блок `cube` для payload анализа. Значение для
// сервера — square_size_m (сторона одной клетки в метрах).
//
// Стандарт: 4 клетки на грани, сторона квадрата 17.5 мм (0.0175 м), грань 70 мм.
export const CUBE_DEFAULT = {
  square_size_m:    0.0175,
  squares_per_side: 4,
  is_custom:        false,
  input_mode:       'square',
  raw_value_mm:     17.5,
}

const DEF_N      = 4
const DEF_SQUARE = '17.5'   // мм
const DEF_EDGE   = '70'     // мм

// Границы валидации
const N_MIN = 2,  N_MAX = 10
const SQ_MIN = 3, SQ_MAX = 60      // сторона квадрата, мм
const ED_MIN = 15, ED_MAX = 300    // длина грани, мм

const round5 = (v) => Math.round(v * 1e5) / 1e5

// Аккуратный вывод числа: до 2 знаков после запятой, без хвостовых нулей.
const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '')

/**
 * @param {(state: { payload: object, valid: boolean }) => void} onChange
 *   Вызывается при каждом изменении — отдаёт готовый блок cube и флаг валидности.
 */
export default function CubeSettings({ onChange }) {
  const [open, setOpen]        = useState(false)
  const [nStr, setNStr]        = useState(String(DEF_N))
  const [squareStr, setSquare] = useState(DEF_SQUARE)  // сторона квадрата, мм
  const [edgeStr, setEdge]     = useState(DEF_EDGE)    // длина грани, мм

  // Какое поле пользователь редактировал вручную последним — от него ведём
  // пересчёт при смене N, чтобы N не «наступал» на только что введённое значение.
  const [lastEdited, setLastEdited] = useState('square')  // 'square' | 'edge'

  // Поле, которое только что пересчиталось автоматически — для лёгкой подсветки.
  const [pulse, setPulse]  = useState(null)               // 'square' | 'edge' | null
  const pulseTimer         = useRef(null)
  const firePulse = (field) => {
    setPulse(field)
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(null), 450)
  }
  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current) }, [])

  // ─── Живая двусторонняя синхронизация ──────────────────────────────────────
  // Оба поля всегда активны. При правке одного второе пересчитывается как
  // производное: грань = сторона × N, сторона = грань / N.
  const onSquareChange = (val) => {
    setSquare(val)
    setLastEdited('square')
    const sq = Number(val), n = Number(nStr)
    if (val.trim() !== '' && Number.isFinite(sq) && Number.isInteger(n) && n > 0) {
      setEdge(fmt(sq * n)); firePulse('edge')
    }
  }
  const onEdgeChange = (val) => {
    setEdge(val)
    setLastEdited('edge')
    const ed = Number(val), n = Number(nStr)
    if (val.trim() !== '' && Number.isFinite(ed) && Number.isInteger(n) && n > 0) {
      setSquare(fmt(ed / n)); firePulse('square')
    }
  }
  const onNChange = (val) => {
    setNStr(val)
    const n = Number(val)
    if (val.trim() === '' || !Number.isInteger(n) || n <= 0) return
    // Пересчитываем то поле, которое НЕ редактировали вручную последним.
    if (lastEdited === 'square') {
      const sq = Number(squareStr)
      if (squareStr.trim() !== '' && Number.isFinite(sq)) { setEdge(fmt(sq * n)); firePulse('edge') }
    } else {
      const ed = Number(edgeStr)
      if (edgeStr.trim() !== '' && Number.isFinite(ed)) { setSquare(fmt(ed / n)); firePulse('square') }
    }
  }

  // ─── Валидация и payload ────────────────────────────────────────────────────
  const derived = useMemo(() => {
    const n = Number(nStr)
    const nValid = Number.isInteger(n) && n >= N_MIN && n <= N_MAX

    const sq = Number(squareStr)
    const squareValid = squareStr.trim() !== '' && Number.isFinite(sq) && sq >= SQ_MIN && sq <= SQ_MAX

    const ed = Number(edgeStr)
    const edgeValid = edgeStr.trim() !== '' && Number.isFinite(ed) && ed >= ED_MIN && ed <= ED_MAX

    const valid = nValid && squareValid && edgeValid
    const sizeM = squareValid ? round5(sq / 1000) : null

    const is_custom = valid && (sizeM !== CUBE_DEFAULT.square_size_m || n !== CUBE_DEFAULT.squares_per_side)

    const payload = {
      square_size_m:    valid ? sizeM : CUBE_DEFAULT.square_size_m,
      squares_per_side: nValid ? n : CUBE_DEFAULT.squares_per_side,
      is_custom:        !!is_custom,
      input_mode:       lastEdited,
      raw_value_mm:     squareValid ? sq : CUBE_DEFAULT.raw_value_mm,
    }

    return { payload, valid, nValid, squareValid, edgeValid, is_custom: !!is_custom, sizeM }
  }, [nStr, squareStr, edgeStr, lastEdited])

  // Пробрасываем наверх результат при каждом изменении.
  useEffect(() => {
    onChange?.({ payload: derived.payload, valid: derived.valid })
  }, [derived, onChange])

  const reset = () => {
    setNStr(String(DEF_N))
    setSquare(DEF_SQUARE)
    setEdge(DEF_EDGE)
    setLastEdited('square')
  }

  const changed = derived.is_custom

  // Подсветка невалидных полей (показываем ошибку, когда поле реально не в порядке).
  const nBad      = !derived.nValid
  const squareBad = !derived.squareValid
  const edgeBad   = !derived.edgeValid

  return (
    <div className="cube">
      <div className="cube-trigger-row">
        <button
          type="button"
          className={`cube-trigger ${changed ? 'is-changed' : ''} ${open ? 'is-open' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label="Параметры калибровочного куба"
          title={changed ? 'Параметры куба изменены' : 'Параметры калибровочного куба'}
        >
          {changed ? <UserCog size={18} /> : <Settings size={18} />}
          {changed && <span className="cube-dot" aria-hidden="true" />}
        </button>
      </div>

      <div className={`cube-panel ${open ? 'is-open' : ''}`}>
        <div className="cube-panel-inner">
          <div className="cube-hd">Параметры калибровочного куба</div>

          <div className="cube-fields">
            <div className="field">
              <label>Клеток на грани</label>
              <input
                type="number" min={N_MIN} max={N_MAX} step={1} inputMode="numeric"
                className={nBad ? 'cube-invalid' : ''}
                value={nStr}
                onChange={e => onNChange(e.target.value)}
              />
              {nBad && <span className="cube-field-error">Введите число клеток от {N_MIN} до {N_MAX}</span>}
            </div>

            <div className="cube-pair">
              <div className="field">
                <label>Сторона квадрата, мм</label>
                <input
                  type="number" min={SQ_MIN} max={SQ_MAX} step="0.1" inputMode="decimal"
                  placeholder="17.5"
                  className={`${squareBad ? 'cube-invalid' : ''} ${pulse === 'square' ? 'cube-pulse' : ''}`}
                  value={squareStr}
                  onChange={e => onSquareChange(e.target.value)}
                />
                {squareBad && <span className="cube-field-error">Сторона квадрата должна быть от {SQ_MIN} до {SQ_MAX} мм</span>}
              </div>
              <div className="field">
                <label>Длина грани, мм</label>
                <input
                  type="number" min={ED_MIN} max={ED_MAX} step="0.1" inputMode="decimal"
                  placeholder="70"
                  className={`${edgeBad ? 'cube-invalid' : ''} ${pulse === 'edge' ? 'cube-pulse' : ''}`}
                  value={edgeStr}
                  onChange={e => onEdgeChange(e.target.value)}
                />
                {edgeBad && <span className="cube-field-error">Длина грани должна быть от {ED_MIN} до {ED_MAX} мм</span>}
              </div>
            </div>
          </div>

          {changed && (
            <button type="button" className="cube-reset" onClick={reset}>
              Сбросить к стандартным
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
