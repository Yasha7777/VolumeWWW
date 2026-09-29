import { LIGHT_ROCKS, LIGHT_PEBBLES, DARK_ROCKS, DARK_LINES } from './decor'

// every decor asset as a hashed URL; only the active theme's images are rendered (and fetched)
const files = import.meta.glob('./img/*.webp', { eager: true, query: '?url', import: 'default' })
const url = (name) => files[`./img/${name}.webp`]
const plateDark = url('plate-dark')

const HALF = 768 // centre of the 1536 canvas

function Piece({ s, x, y, w, r = 0, f, cls = '' }) {
  const right = x + w / 2 > HALF
  const style = {
    top: y, width: w,
    transform: `rotate(${r}deg)${f ? ' scaleX(-1)' : ''}`,
    ...(right ? { left: x - HALF } : { left: x }),
  }
  return <img className={'ks-rock ' + cls} src={url(s)} alt="" style={style} draggable="false" decoding="async" loading="eager" />
}

function Cross({ x, y, size = 32, ring = 6 }) {
  const h = size / 2
  return (
    <svg className="ks-cross" style={{ left: x - h, top: y - h, width: size, height: size }} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <line x1="0" y1={h} x2={size} y2={h} /><line x1={h} y1="0" x2={h} y2={size} />
      {ring > 0 && <circle cx={h} cy={h} r={ring} />}
    </svg>
  )
}

export default function AnalyzeDecor({ theme = 'light' }) {
  const dark = theme === 'dark'
  const rocks = dark ? DARK_ROCKS : LIGHT_ROCKS
  const pebbles = dark ? [] : LIGHT_PEBBLES
  const side = (right) => rocks.filter((p) => (p.x + p.w / 2 > HALF) === right)
  const pebSide = (right) => pebbles.filter(([x, , s]) => (x + s / 2 > HALF) === right)

  return (
    <div className={'ks-decor' + (dark ? ' is-dark' : '')} aria-hidden style={dark ? { backgroundImage: `url(${plateDark})` } : undefined}>
      {[false, true].map((right) => (
        <div key={String(right)} className={'ks-decor__side ' + (right ? 'is-right' : 'is-left')}>
          {dark && (
            <svg className="ks-decor__lines" viewBox={right ? '768 0 768 1024' : '0 0 768 1024'} aria-hidden>
              {DARK_LINES.map((d, i) => <path key={i} d={d} />)}
            </svg>
          )}
          {pebSide(right).map(([x, y, s, n, r], i) => (
            <Piece key={'p' + i} s={'peb-' + String(n).padStart(2, '0')} x={x} y={y} w={s} r={r} cls="is-pebble" />
          ))}
          {side(right).map((p, i) => <Piece key={i} {...p} cls={p.s.startsWith('cube') ? 'is-cube' : ''} />)}

          {!right && (
            <>
              <Cross x={48} y={146} size={32} ring={5} />
              <div className="ks-mark ks-mark--coords" style={{ left: 78, top: 120 }}>61.7956° N<br />34.3686° E</div>
              <div className="ks-mark ks-mark--tags" style={{ left: 213, top: 214 }}>
                <span className="ks-mark__tri">▸</span>
                <span>Фотограмметрия<br />3D-реконструкция<br />Объём / вес</span>
              </div>
              <div className="ks-mark ks-mark--foot" style={{ left: 38, top: 968 }}><span className="ks-mark__brand">Карелия Строй</span><br />Точные данные. Реальные объекты.</div>
            </>
          )}
          {right && (
            <>
              <Cross x={1399 - HALF} y={235} size={34} ring={7} />
              <div className="ks-mark ks-mark--gps" style={{ left: 1434 - HALF, top: 207 }}>GPS / ARKit<br />ТОЧНОСТЬ<br />±1.5%</div>
              <div className="ks-mark ks-mark--coords2" style={{ left: 1300 - HALF, top: 976 }}>61.7956° N&nbsp;&nbsp;&nbsp;34.3686° E</div>
              <Cross x={1482 - HALF} y={983} size={32} ring={6} />
            </>
          )}
        </div>
      ))}
    </div>
  )
}
