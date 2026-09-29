import { useMemo } from 'react'
import { Plus, Minus, Camera } from 'lucide-react'
import { DEMO_MAP } from './demo'

const W = 539, H = 488

// Catmull-Rom → кубические Безье: плавная линия обхода через точки кадров
function smooth(pts, closed = false) {
  if (pts.length < 2) return ''
  const p = closed ? [pts[pts.length - 2], ...pts, pts[1]] : [pts[0], ...pts, pts[pts.length - 1]]
  let d = `M${p[1][0].toFixed(1)},${p[1][1].toFixed(1)}`
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2]
    const t = 0.5 / 3
    d += ` C${(x1 + (x2 - x0) * t).toFixed(1)},${(y1 + (y2 - y0) * t).toFixed(1)} ${(x2 - (x3 - x1) * t).toFixed(1)},${(y2 - (y3 - y1) * t).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
  }
  return d
}

const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

/* Траектория ARKit (метры, вид сверху: x вправо, z вниз) → координаты карточки.
   Масштаб честный: линейка внизу считается из того же коэффициента. */
function fitTrack(points) {
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const box = { l: 60, r: 60, t: 110, b: 90 }
  const s = Math.min((W - box.l - box.r) / Math.max(maxX - minX, 0.5), (H - box.t - box.b) / Math.max(maxZ - minZ, 0.5))
  const ox = box.l + ((W - box.l - box.r) - (maxX - minX) * s) / 2
  const oy = box.t + ((H - box.t - box.b) - (maxZ - minZ) * s) / 2
  const pts = points.map(([x, z]) => [ox + (x - minX) * s, oy + (z - minZ) * s])
  const L = NICE.find((n) => n * s >= 70) || NICE[NICE.length - 1]
  return { pts, pxPerM: s, bar: { len: L * s, label: L } }
}

const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`

function CameraPin({ at: [x, y], muted }) {
  return (
    <g transform={`translate(${x} ${y})`} className={'ks-cam' + (muted ? ' is-muted' : '')}>
      <circle r="13.5" className="ks-cam__halo" />
      <circle r="11" className="ks-cam__bg" />
      <g transform="translate(-6 -6)"><Camera size={12} strokeWidth={2} color="#fff" /></g>
    </g>
  )
}

export default function ObhodMap({ demo = false, track = null, loading = false }) {
  const real = useMemo(() => (!demo && track?.points?.length > 1 ? fitTrack(track.points) : null), [demo, track])

  let body, loc, scale
  if (demo) {
    const g = DEMO_MAP
    body = (
      <>
        <path d={smooth(g.otherRoute)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherRoute2)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherLink)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherSpur)} className="ks-route ks-route--other ks-route--dash" />
        <path d={smooth(g.selectedRoute, true)} className="ks-route ks-route--sel" />
        <path d={smooth(g.selectedInner)} className="ks-route ks-route--sel ks-route--thin" />
        {g.otherNodes.map(([x, y], i) => <circle key={'o' + i} cx={x} cy={y} r="2.6" className="ks-node" />)}
        {g.selNodes.map(([x, y], i) => <circle key={'s' + i} cx={x} cy={y} r="2.8" className="ks-node ks-node--sel" />)}
        {g.whiteNodes.map(([x, y], i) => <g key={'w' + i}><circle cx={x} cy={y} r="5.2" className="ks-node-ring" /><circle cx={x} cy={y} r="2" className="ks-node" /></g>)}
        <circle cx={g.start[0]} cy={g.start[1]} r="9" className="ks-start-glow" />
        <circle cx={g.start[0]} cy={g.start[1]} r="5.5" className="ks-start" />
        {g.cameras.map((c, i) => <CameraPin key={i} {...c} />)}
      </>
    )
    loc = (<><span><i aria-hidden>+</i>Петрозаводск</span><span><i aria-hidden>↓</i>≈ 12.4 км</span></>)
    scale = { ticks: [['0', 0], ['250', 47], ['500', 84]], end: '1 000 м', width: 183 }
  } else if (real) {
    const { pts, bar } = real
    const step = Math.max(1, Math.ceil(pts.length / 6))
    const cams = pts.filter((_, i) => i % step === 0 && i > 0)
    const nodeStep = Math.max(1, Math.ceil(pts.length / 24))
    body = (
      <>
        <path d={smooth(pts)} className="ks-route ks-route--sel" />
        {pts.filter((_, i) => i % nodeStep === 0).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" className="ks-node ks-node--sel" />)}
        <circle cx={pts[0][0]} cy={pts[0][1]} r="9" className="ks-start-glow" />
        <circle cx={pts[0][0]} cy={pts[0][1]} r="5.5" className="ks-start" />
        {cams.map((p, i) => <CameraPin key={i} at={p} />)}
      </>
    )
    const t = track
    loc = t.lat != null && t.lon != null
      ? (<><span><i aria-hidden>+</i>{fmtCoord(t.lat, 'N', 'S')}, {fmtCoord(t.lon, 'E', 'W')}</span>
          <span><i aria-hidden>±</i>{t.acc != null ? `${Math.round(t.acc)} м по GPS` : 'точность GPS неизвестна'}</span></>)
      : (<><span><i aria-hidden>+</i>Нет GPS в обходе</span><span><i aria-hidden>↻</i>Траектория ARKit, север не задан</span></>)
    const L = bar.label
    scale = { ticks: [['0', 0], [String(L / 2).replace('.', ','), bar.len / 2 - 6]], end: `${String(L).replace('.', ',')} м`, width: bar.len }
  } else {
    body = null
    loc = <span className="ks-map__hint">{loading ? 'Загружаем траекторию…' : 'Выберите обход — здесь появится его траектория'}</span>
    scale = null
  }

  return (
    <div className="ks-map">
      <div className="ks-map__terrain" />
      <svg className="ks-map__svg" viewBox={`0 0 ${W} ${H}`} aria-hidden>{body}</svg>

      <div className="ks-map__head">
        <h3 className="ks-map__title">Карта обходов</h3>
        <div className="ks-map__loc">{loc}</div>
      </div>

      <div className="ks-map__zoom" aria-hidden>
        <button type="button" tabIndex={-1} aria-label="Приблизить"><Plus size={14} strokeWidth={1.8} /></button>
        <button type="button" tabIndex={-1} aria-label="Отдалить"><Minus size={14} strokeWidth={1.8} /></button>
      </div>

      <div className="ks-map__compass" aria-hidden>
        <span className="ks-map__compass-n">N</span>
        <span className="ks-map__compass-ring"><span className="ks-map__compass-needle" /></span>
      </div>

      <ul className="ks-map__legend">
        <li><i className="dot dot--sel" />Выбранный обход</li>
        {demo && <li><i className="dot dot--other" />Другие обходы</li>}
        <li><i className="cam"><Camera size={10} strokeWidth={2} /></i>Точки съёмки</li>
      </ul>

      {scale && (
        <div className="ks-map__scale" style={{ width: scale.width }} aria-hidden>
          <div className="ks-map__scale-labels">
            {scale.ticks.map(([t, x]) => <span key={t} style={{ left: x }}>{t}</span>)}
            <span style={{ right: 0 }}>{scale.end}</span>
          </div>
          <div className="ks-map__scale-bar" />
        </div>
      )}
    </div>
  )
}
