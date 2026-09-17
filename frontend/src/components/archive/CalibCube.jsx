/* ============================================================
   CalibCube — карточка калибровочного куба.
   ------------------------------------------------------------
   Шахматный куб в 3D (CSS-трансформы, без three.js: сцена
   статична, тянуть ради неё WebGL-контекст незачем) плюс
   выносные размеры и спецификация.

   ВАЖНО: размер грани и число клеток берутся из РЕАЛЬНЫХ
   параметров куба (components/CubeSettings.jsx) — тех самых,
   что уходят в payload анализа. На макете стоит 710 мм, но в
   приложении стандарт другой (4 клетки × 17.5 мм = 70 мм), и
   рисовать в интерфейсе число, которого нет в расчёте, нельзя:
   пользователь поедет в поле с не тем кубом. Поменяются
   параметры в окне СВОЙСТВА_КУБА — поменяется и карточка.

   Термин по всей теме один — «КАЛИБРОВОЧНЫЙ КУБ», не «эталон».
   ============================================================ */

/** аккуратное число: без хвостовых нулей */
const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—')

export default function CalibCube({
  edgeMm = 70,
  squaresPerSide = 4,
  compact = false,
}) {
  const edge = fmt(edgeMm)
  // шахматка: одна плитка градиента = 2 клетки, поэтому шаг вдвое крупнее
  const tile = `${100 / Math.max(1, squaresPerSide) * 2}%`
  const cellVars = { '--arc-cube-tile': tile }

  return (
    <div className={`arc-cube${compact ? ' arc-cube--compact' : ''}`}>
      <div className="arc-cube__stage" style={cellVars} aria-hidden="true">
        <div className="arc-cube__box">
          <span className="arc-cube__face arc-cube__face--top" />
          <span className="arc-cube__face arc-cube__face--front" />
          <span className="arc-cube__face arc-cube__face--right" />
        </div>
        {/* выносные размеры — по нижней и правой грани */}
        <span className="arc-cube__dim arc-cube__dim--w">{edge}</span>
        <span className="arc-cube__dim arc-cube__dim--h">{edge}</span>
      </div>

      <dl className="arc-cube__spec">
        <dt>КАЛИБРОВОЧНЫЙ КУБ</dt>
        <dd>ЭТАЛОН МАСШТАБА</dd>
        <dd className="arc-cube__size">{edge}×{edge}×{edge} мм</dd>
        <dd>{squaresPerSide} КЛЕТКИ НА ГРАНЬ</dd>
        <dd className="arc-cube__must">ОБЯЗАТЕЛЕН В КАДРЕ</dd>
      </dl>
    </div>
  )
}
