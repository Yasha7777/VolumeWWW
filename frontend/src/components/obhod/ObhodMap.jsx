import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Plus, Minus, Camera, Play, Pause, Map as MapIcon, Box, MapPin } from 'lucide-react'
import { DEMO_MAP } from './demo'
import ObhodSatellite, { YMAPS_KEY } from './ObhodSatellite'

const ObhodCloud = lazy(() => import('./ObhodCloud'))

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
  const map = ([x, z]) => [ox + (x - minX) * s, oy + (z - minZ) * s]
  const pts = points.map(map)
  const L = NICE.find((n) => n * s >= 70) || NICE[NICE.length - 1]
  return { pts, map, pxPerM: s, bar: { len: L * s, label: L } }
}

const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`
const pad = (n) => String(n).padStart(2, '0')
const fmtT = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`

function CameraPin({ at: [x, y], muted }) {
  return (
    <g transform={`translate(${x} ${y})`} className={'ks-cam' + (muted ? ' is-muted' : '')}>
      <circle r="13.5" className="ks-cam__halo" />
      <circle r="11" className="ks-cam__bg" />
      <g transform="translate(-6 -6)"><Camera size={12} strokeWidth={2} color="#fff" /></g>
    </g>
  )
}

/* Проигрывание обхода: точка идёт по линии выбранного обхода, за ней —
   пройденный участок, над ней — кадр, снятый в этом месте. Кадры
   привязаны к длине пути: frames[i].at → ближайшая точка на линии.
   Всё двигается через ref, без перерисовки React на каждый кадр. */
function useReplay({ pathRef, frames, duration = 7, auto = true, reduce }) {
  const [playing, setPlaying] = useState(false)
  const [frame, setFrame] = useState(null)
  const dot = useRef(null), trail = useRef(null), bubble = useRef(null)
  const st = useRef({ raf: 0, t: 0, last: 0, len: 0, marks: [] })

  const prepare = useCallback(() => {
    const p = pathRef.current
    if (!p) return false
    const len = p.getTotalLength()
    // длина пути до каждого кадра — по ближайшей точке выборки
    const S = 400, samples = []
    for (let i = 0; i <= S; i++) { const q = p.getPointAtLength((len * i) / S); samples.push([q.x, q.y, (len * i) / S]) }
    st.current.len = len
    st.current.marks = (frames || []).map((f) => {
      let best = samples[0], bd = Infinity
      for (const s of samples) { const d = (s[0] - f.at[0]) ** 2 + (s[1] - f.at[1]) ** 2; if (d < bd) { bd = d; best = s } }
      return best[2]
    }).map((l, i) => ({ l, i })).sort((a, b) => a.l - b.l)
    if (trail.current) { trail.current.style.strokeDasharray = `${len} ${len}`; trail.current.style.strokeDashoffset = String(len) }
    return true
  }, [pathRef, frames])

  const draw = useCallback((t) => {
    const { len, marks } = st.current
    const p = pathRef.current
    if (!p || !len) return
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2   // easeInOutQuad
    const l = len * e
    const q = p.getPointAtLength(l)
    if (dot.current) dot.current.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`)
    if (trail.current) trail.current.style.strokeDashoffset = String(len - l)
    if (bubble.current) {
      const below = q.y < 120
      bubble.current.style.transform = `translate(${(Math.min(W - 60, Math.max(60, q.x))).toFixed(1)}px, ${q.y.toFixed(1)}px) translate(-50%, ${below ? '18px' : 'calc(-100% - 16px)'})`
      bubble.current.classList.toggle('is-below', below)
    }
    let cur = null
    for (const m of marks) if (m.l <= l + 4) cur = m.i
    setFrame((f) => (f === cur ? f : cur))
  }, [pathRef])

  const stop = useCallback(() => { cancelAnimationFrame(st.current.raf); st.current.raf = 0; setPlaying(false) }, [])

  const play = useCallback(() => {
    if (!prepare()) return
    cancelAnimationFrame(st.current.raf)
    if (st.current.t >= 1) st.current.t = 0
    setPlaying(true)
    st.current.last = performance.now()
    const tick = (now) => {
      const s = st.current
      s.t = Math.min(1, s.t + (now - s.last) / 1000 / duration); s.last = now
      draw(s.t)
      if (s.t < 1) s.raf = requestAnimationFrame(tick)
      else { s.raf = 0; setPlaying(false); setTimeout(() => setFrame(null), 1400) }
    }
    st.current.raf = requestAnimationFrame(tick)
  }, [prepare, draw, duration])

  // автозапуск один раз, когда карта появилась
  useEffect(() => {
    if (!auto || reduce || !frames?.length) return
    const id = setTimeout(play, 1100)
    return () => clearTimeout(id)
  }, [auto, reduce, frames, play])
  useEffect(() => () => cancelAnimationFrame(st.current.raf), [])

  return { playing, frame, play, stop, dot, trail, bubble, started: st.current.t > 0 || playing }
}

export default function ObhodMap({ demo = false, track = null, loading = false, cloud = null, theme = 'light' }) {
  const reduce = useReducedMotion()
  const [view, setView] = useState('map')
  // спутник Яндекса — когда обход привязан к северу (компас/GPS из приложения ≥ 5)
  const geo = !demo && YMAPS_KEY && track?.geo?.rot_deg != null && track.geo.points_en?.length > 1 ? track.geo : null
  const [sat, setSat] = useState(null)          // { toPx, mpp } от подложки
  const [satFailed, setSatFailed] = useState(false)
  useEffect(() => { setSat(null); setSatFailed(false) }, [geo])
  const real = useMemo(() => {
    if (demo || !(track?.points?.length > 1)) return null
    if (geo && sat) {
      const pts = geo.points_en.map(sat.toPx)
      const L = NICE.find((n) => n / sat.mpp >= 70) || NICE[NICE.length - 1]
      const fr = geo.frames_en || []
      return { pts, frameAt: (i) => (fr[i] ? sat.toPx(fr[i]) : null), bar: { len: L / sat.mpp, label: L }, onSat: true }
    }
    const fit = fitTrack(track.points)
    return { ...fit, frameAt: (i) => fit.map(track.frames[i].at) }
  }, [demo, track, geo, sat])
  const selPath = useRef(null)

  // кадры для проигрывания: демо — готовый набор, реальный обход — из /track
  const frames = useMemo(() => {
    if (demo) return DEMO_MAP.walk || null
    if (real && track?.frames?.length) {
      const last = Math.max(1, (track.frameCount || track.frames.length) - 1)
      return track.frames
        .map((f, i) => ({ thumb: f.thumb, at: real.frameAt(i), n: f.index + 1, frac: f.index / last }))
        .filter((f) => f.thumb && f.at)
    }
    return null
  }, [demo, real, track])
  const total = demo ? DEMO_MAP.walkTotal : track?.frameCount
  const durS = demo ? DEMO_MAP.walkDuration : track?.duration
  const rp = useReplay({ pathRef: selPath, frames, reduce, auto: view === 'map' })
  const cur = rp.frame != null && frames ? frames[rp.frame] : null

  let body, loc, scale, selD = ''
  if (demo) {
    const g = DEMO_MAP
    selD = smooth(g.selectedRoute, true)
    body = (
      <>
        <path d={smooth(g.otherRoute)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherRoute2)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherLink)} className="ks-route ks-route--other" />
        <path d={smooth(g.otherSpur)} className="ks-route ks-route--other ks-route--dash" />
        <path ref={selPath} d={selD} className="ks-route ks-route--sel" />
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
    selD = smooth(pts)
    const step = Math.max(1, Math.ceil(pts.length / 6))
    const cams = pts.filter((_, i) => i % step === 0 && i > 0)
    const nodeStep = Math.max(1, Math.ceil(pts.length / 24))
    body = (
      <>
        <path ref={selPath} d={selD} className="ks-route ks-route--sel" />
        {pts.filter((_, i) => i % nodeStep === 0).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" className="ks-node ks-node--sel" />)}
        <circle cx={pts[0][0]} cy={pts[0][1]} r="9" className="ks-start-glow" />
        <circle cx={pts[0][0]} cy={pts[0][1]} r="5.5" className="ks-start" />
        {cams.map((p, i) => <CameraPin key={i} at={p} />)}
      </>
    )
    const t = track
    loc = real.onSat
      ? (<><span><i aria-hidden>+</i>{fmtCoord(geo.lat0, 'N', 'S')}, {fmtCoord(geo.lon0, 'E', 'W')}</span>
          <span><i aria-hidden>N</i>{geo.rot_source === 'compass' ? `Север по компасу ±${Math.round(geo.rot_spread_deg ?? 0)}°` : 'Север по GPS'} · ±{Math.round(geo.acc_m)} м</span></>)
      : t.lat != null && t.lon != null
      ? (<><span><i aria-hidden>+</i>{fmtCoord(t.lat, 'N', 'S')}, {fmtCoord(t.lon, 'E', 'W')}</span>
          <span><i aria-hidden>±</i>{t.acc != null ? `${Math.round(t.acc)} м по GPS` : 'точность GPS неизвестна'}</span></>)
      : (<><span><i aria-hidden>+</i>Нет GPS в обходе</span><span><i aria-hidden>↻</i>Траектория ARKit, север не задан</span></>)
    const L = bar.label
    scale = { ticks: [['0', 0], [String(L / 2).replace('.', ','), bar.len / 2 - 6]], end: `${String(L).replace('.', ',')} м`, width: bar.len }
  } else {
    // обход не выбран: подложка — аэрофото карьера (не план конкретного обхода),
    // поверх — подсказка по центру
    body = null
    loc = null
    scale = null
  }

  const is3d = view === '3d'
  const switchView = (v) => { if (v !== view) { rp.stop(); setView(v) } }

  return (
    <div className={'ks-map' + (is3d ? ' is-3d' : '') + (geo && !satFailed ? ' has-sat' : '') + (real && !real.onSat ? ' is-plain' : '') + (!demo && !real ? ' is-idle' : '')}>
      {geo && !satFailed && !is3d
        ? <ObhodSatellite geo={geo} theme={theme} onProjection={setSat} onError={() => setSatFailed(true)} />
        : <div className="ks-map__terrain" />}
      {!is3d && (
        <svg className="ks-map__svg" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          {body}
          {frames && body && (
            <g className={'ks-replay' + (rp.started ? ' is-on' : '')}>
              <path ref={rp.trail} d={selD} className="ks-replay__trail" />
              <g ref={rp.dot} className="ks-replay__dot">
                <circle r="15" className="ks-replay__pulse" />
                <circle r="6.5" className="ks-replay__core" />
              </g>
            </g>
          )}
        </svg>
      )}

      {!is3d && !demo && !real && (
        <div className="ks-map__empty">
          {loading ? <span className="ks-cloud__spin" /> : <MapPin size={15} strokeWidth={1.8} aria-hidden />}
          <span>{loading ? 'Загружаем траекторию…' : <>Выберите обход справа —<br />здесь появится его траектория</>}</span>
        </div>
      )}

      {!is3d && frames && (
        <div ref={rp.bubble} className={'ks-shot' + (cur ? ' is-on' : '')} aria-hidden>
          {cur && <img key={cur.thumb} src={cur.thumb} alt="" />}
          {cur && <span className="ks-shot__cap">Кадр {cur.n}{total ? ` / ${total}` : ''}{durS && cur.frac != null ? ` · ${fmtT(durS * cur.frac)}` : ''}</span>}
        </div>
      )}

      {is3d && (
        <Suspense fallback={<div className="ks-cloud"><div className="ks-cloud__msg"><span className="ks-cloud__spin" />Загружаем 3D…</div></div>}>
          {cloud?.src || cloud?.data
            ? <ObhodCloud src={cloud.src} data={cloud.data} theme={theme} />
            : <div className="ks-cloud"><div className="ks-cloud__msg is-empty">{cloud?.empty || 'Облако точек появится, когда обход загрузится с телефона'}</div></div>}
        </Suspense>
      )}

      <div className="ks-map__head">
        <div className="ks-map__tabs" role="tablist" aria-label="Вид">
          <button type="button" role="tab" aria-selected={!is3d} className={'ks-map__tab' + (!is3d ? ' is-on' : '')} onClick={() => switchView('map')}>
            <MapIcon size={13} strokeWidth={1.8} aria-hidden />Карта обходов
          </button>
          <button type="button" role="tab" aria-selected={is3d} className={'ks-map__tab' + (is3d ? ' is-on' : '')} onClick={() => switchView('3d')}>
            <Box size={13} strokeWidth={1.8} aria-hidden />3D-облако
          </button>
        </div>
        {!is3d && loc && <div className="ks-map__loc">{loc}</div>}
        {is3d && cloud?.title && (
          <div className="ks-map__loc ks-map__loc--3d">
            <span><i aria-hidden>▲</i>{cloud.title}</span>
            {cloud.meta && <span><i aria-hidden>·</i>{cloud.meta}</span>}
          </div>
        )}
      </div>

      {!is3d && (
        <>
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

          {frames && body && (
            <button type="button" className="ks-map__play" onClick={rp.playing ? rp.stop : rp.play} aria-label={rp.playing ? 'Остановить проигрывание обхода' : 'Проиграть обход'}>
              {rp.playing ? <Pause size={11} strokeWidth={2.2} /> : <Play size={11} strokeWidth={2.2} />}
              <span>{rp.playing ? 'Пауза' : 'Проиграть обход'}</span>
            </button>
          )}

          {scale && (
            <div className="ks-map__scale" style={{ width: scale.width }} aria-hidden>
              <div className="ks-map__scale-labels">
                {scale.ticks.map(([t, x]) => <span key={t} style={{ left: x }}>{t}</span>)}
                <span style={{ right: 0 }}>{scale.end}</span>
              </div>
              <div className="ks-map__scale-bar" />
            </div>
          )}
        </>
      )}
    </div>
  )
}
