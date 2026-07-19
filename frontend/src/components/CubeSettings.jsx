import { useEffect, useMemo, useState } from 'react'
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
const SQ_MIN = 3, SQ_MAX = 60      // сторона квадрata, мм
const ED_MIN = 15, ED_MAX = 300    // длина грани, мм

const round5 = (v) => Math.round(v * 1e5) / 1e5

/**
 * @param {(state: { payload: object, valid: boolean }) => void} onChange
 *   Вызывается при каждом изменении — отдаёт готовый блок cube и флаг валидности.
 */
export default function CubeSettings({ onChange }) {
  const [open, setOpen]       = useState(false)
  const [nStr, setNStr]       = useState(String(DEF_N))
  const [squareStr, setSquare] = useState(DEF_SQUARE)  // сторона квадрата, мм
  const [edgeStr, setEdge]     = useState('')          // длина грани, мм

  // Активный режим: пока заполнено поле квадрата — «square», иначе «edge».
  const mode = squareStr.trim() !== '' ? 'square'
             : edgeStr.trim()   !== '' ? 'edge'
             : 'square'

  // ─── Вычисления и валидация ────────────────────────────────────────────────
  const derived = useMemo(() => {
    const n = Number(nStr)
    const nValid = Number.isInteger(n) && n >= N_MIN && n <= N_MAX

    let square_size_m = null
    let raw_value_mm  = null
    let fieldValid    = false

    if (mode === 'square') {
      const sq = Number(squareStr)
      const ok = squareStr.trim() !== '' && Number.isFinite(sq) && sq >= SQ_MIN && sq <= SQ_MAX
      fieldValid = ok
      if (ok) { square_size_m = sq / 1000; raw_value_mm = sq }
    } else {
      const ed = Number(edgeStr)
      const ok = edgeStr.trim() !== '' && Number.isFinite(ed) && ed >= ED_MIN && ed <= ED_MAX
      fieldValid = ok && nValid
      if (ok && nValid) { square_size_m = (ed / n) / 1000; raw_value_mm = ed }
    }

    const valid = nValid && fieldValid
    const sizeM = valid ? round5(square_size_m) : null

    const is_custom = valid && (sizeM !== CUBE_DEFAULT.square_size_m || n !== CUBE_DEFAULT.squares_per_side)

    const payload = {
      square_size_m:    valid ? sizeM : CUBE_DEFAULT.square_size_m,
      squares_per_side: nValid ? n : CUBE_DEFAULT.squares_per_side,
      is_custom:        !!is_custom,
      input_mode:       mode,
      raw_value_mm:     valid ? raw_value_mm : CUBE_DEFAULT.raw_value_mm,
    }

    return { payload, valid, nValid, fieldValid, is_custom: !!is_custom, sizeM }
  }, [nStr, squareStr, edgeStr, mode])

  // Пробрасываем наверх результат при каждом изменении.
  useEffect(() => {
    onChange?.({ payload: derived.payload, valid: derived.valid })
  }, [derived, onChange])

  const reset = () => {
    setNStr(String(DEF_N))
    setSquare(DEF_SQUARE)
    setEdge('')
  }

  const changed = derived.is_custom
  const squareDisabled = mode === 'edge'
  const edgeDisabled   = mode === 'square'

  // Подсветка невалидных полей
  const nBad      = !derived.nValid
  const squareBad = mode === 'square' && !derived.fieldValid && squareStr.trim() !== ''
  const edgeBad   = mode === 'edge' && (edgeStr.trim() === '' ? false : !derived.fieldValid && derived.nValid)

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
        <span className="cube-trigger-label">Параметры куба</span>
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
                onChange={e => setNStr(e.target.value)}
              />
            </div>

            <div className="cube-pair">
              <div className="field">
                <label>Сторона квадрата, мм</label>
                <input
                  type="number" min={SQ_MIN} max={SQ_MAX} step="0.1" inputMode="decimal"
                  placeholder="17.5"
                  className={squareBad ? 'cube-invalid' : ''}
                  disabled={squareDisabled}
                  value={squareStr}
                  onChange={e => setSquare(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Длина грани, мм</label>
                <input
                  type="number" min={ED_MIN} max={ED_MAX} step="0.1" inputMode="decimal"
                  placeholder="70"
                  className={edgeBad ? 'cube-invalid' : ''}
                  disabled={edgeDisabled}
                  value={edgeStr}
                  onChange={e => setEdge(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="cube-computed">
            {derived.valid ? (
              <>→ сторона квадрата = {(derived.sizeM * 1000).toFixed(1)} мм · передаётся на сервер</>
            ) : (
              <span className="cube-computed-bad">Проверьте значения: N {N_MIN}…{N_MAX}, квадрат {SQ_MIN}…{SQ_MAX} мм, грань {ED_MIN}…{ED_MAX} мм</span>
            )}
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
