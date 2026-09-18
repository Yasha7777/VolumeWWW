/* ============================================================
   CalibCube — карточка калибровочного куба.
   ------------------------------------------------------------
   Куб рисуется SVG в изометрии, а не CSS-трансформами. Прежний
   вариант (три .arc-cube__face с rotateX/rotateY и шахматкой из
   repeating-conic-gradient) выглядел грязно: браузер сглаживает
   повёрнутые градиенты по-своему, клетки на боковых гранях
   плыли и не сходились с рёбрами. Здесь каждая клетка — честный
   полигон с посчитанными координатами, поэтому шахматка ровно
   ложится на грань, а рёбра остаются в один пиксель.

   ВАЖНО: размер грани и число клеток берутся из РЕАЛЬНЫХ
   параметров куба (components/CubeSettings.jsx) — тех самых,
   что уходят в payload анализа. На макете стоит 710 мм, но в
   приложении стандарт другой (4 клетки × 17.5 мм = 70 мм), и
   рисовать в интерфейсе число, которого нет в расчёте, нельзя:
   пользователь поедет в поле с не тем кубом.

   Термин по всей теме один — «КАЛИБРОВОЧНЫЙ КУБ», не «эталон».
   ============================================================ */

const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—')

/* ── изометрия ────────────────────────────────────────────────
   Три вектора ребра в экранных координатах. Ось Z смотрит прямо
   вверх, X и Y расходятся вниз под 30° — классическая «кабинетная»
   изометрия, в которой куб читается как куб без перспективы. */
const S   = 46                       // длина ребра на экране, px
const COS = 0.8660254                // cos(30°)
const UX  = [ COS * S,  0.5 * S ]    // вправо-вниз
const UY  = [ -COS * S, 0.5 * S ]    // влево-вниз
const UZ  = [ 0, S ]                 // вниз (высота грани)

const PAD_L = 10, PAD_T = 8
const TOP   = [PAD_L + COS * S, PAD_T]        // самая верхняя вершина
const W     = 2 * COS * S + PAD_L + 30        // + место под вертикальный размер
const H     = 2 * S + PAD_T + 24              // + место под нижний размер

const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k]
const pts = (...p) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

/** Плитки одной грани: параллелограмм, разбитый на n×n клеток. */
function faceCells(origin, edgeA, edgeB, n, colorEven, colorOdd) {
  const cells = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p0 = add(add(origin, edgeA, i / n), edgeB, j / n)
      const p1 = add(p0, edgeA, 1 / n)
      const p2 = add(p1, edgeB, 1 / n)
      const p3 = add(p0, edgeB, 1 / n)
      cells.push(
        <polygon
          key={`${i}-${j}`}
          points={pts(p0, p1, p2, p3)}
          fill={(i + j) % 2 === 0 ? colorEven : colorOdd}
        />,
      )
    }
  }
  return cells
}

/** Выносной размер: линия со «стрелками»-засечками и подпись. */
function Dim({ from, to, off, label, anchor = 'middle', dx = 0, dy = 0 }) {
  const a = add(from, off)
  const b = add(to, off)
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return (
    <g className="arc-cube__dim">
      <line x1={from[0]} y1={from[1]} x2={a[0]} y2={a[1]} strokeDasharray="1 2" />
      <line x1={to[0]} y1={to[1]} x2={b[0]} y2={b[1]} strokeDasharray="1 2" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      <text x={mid[0] + dx} y={mid[1] + dy} textAnchor={anchor}>{label}</text>
    </g>
  )
}

export default function CalibCube({
  edgeMm = 70,
  squaresPerSide = 4,
  compact = false,
}) {
  const edge = fmt(edgeMm)
  const n = Math.min(10, Math.max(2, Number(squaresPerSide) || 4))

  // вершины куба
  const vRight  = add(TOP, UX)                 // правая верхняя
  const vLeft   = add(TOP, UY)                 // левая верхняя
  const vFront  = add(vLeft, UX)               // ближняя (низ верхней грани)
  const vLeftB  = add(vLeft, UZ)               // левая нижняя
  const vFrontB = add(vFront, UZ)              // ближняя нижняя
  const vRightB = add(vRight, UZ)              // правая нижняя

  return (
    <div className={`arc-cube${compact ? ' arc-cube--compact' : ''}`}>
      <svg
        className="arc-cube__svg"
        viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`}
        role="img"
        aria-label={`Калибровочный куб ${edge} мм, ${n} клеток на грань`}
      >
        {/* верхняя грань — светлая шахматка */}
        <g>{faceCells(TOP, UX, UY, n, 'var(--surface-2)', 'var(--ink)')}</g>
        {/* левая (ближняя) грань — контрастная шахматка */}
        <g>{faceCells(vLeft, UX, UZ, n, 'var(--ink)', 'var(--surface-2)')}</g>
        {/* правая грань — зелёная, чтобы куб читался объёмом, а не плоской звездой */}
        <g>{faceCells(vRight, UY, UZ, n, 'var(--green-bright)', 'var(--green)')}</g>

        {/* рёбра */}
        <g className="arc-cube__edges">
          <polygon points={pts(TOP, vRight, vFront, vLeft)} />
          <polygon points={pts(vLeft, vFront, vFrontB, vLeftB)} />
          <polygon points={pts(vRight, vFront, vFrontB, vRightB)} />
        </g>

        {/* размеры: ребро по низу и высота справа */}
        <Dim from={vLeftB} to={vFrontB} off={[-2, 11]} label={edge} dy={8} />
        <Dim from={vRight} to={vRightB} off={[13, 0]} label={edge} anchor="start" dx={4} dy={3} />
      </svg>

      <dl className="arc-cube__spec">
        <dt>КАЛИБРОВОЧНЫЙ КУБ</dt>
        <dd>ЭТАЛОН МАСШТАБА</dd>
        <dd className="arc-cube__size">{edge}×{edge}×{edge} мм</dd>
        <dd>{n} {n === 1 ? 'КЛЕТКА' : n < 5 ? 'КЛЕТКИ' : 'КЛЕТОК'} НА ГРАНЬ</dd>
        <dd className="arc-cube__must">ОБЯЗАТЕЛЕН В КАДРЕ</dd>
      </dl>
    </div>
  )
}
