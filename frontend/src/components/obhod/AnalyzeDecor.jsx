import { useEffect, useRef } from 'react'
import { LIGHT_ROCKS, DARK_ROCKS, DARK_REST, DARK_WIDE, LIGHT_WIDE } from './decor'

// все картинки декора — хешированные URL; грузятся только картинки активной темы
const files = import.meta.glob('./img/*.webp', { eager: true, query: '?url', import: 'default' })
const url = (name) => files[`./img/${name}.webp`]

const HALF = 768 // центр холста 1536

// подписи и кресты: в светлом и тёмном макетах стоят немного по-разному
const MARKS = {
  light: {
    cross: [[48, 146, 32, 5], [1399, 235, 34, 7], [1482, 983, 32, 6]],
    coords: [78, 120], tags: [213, 214], gps: [1434, 207], foot: [38, 968], coords2: [1300, 976],
  },
  dark: {
    cross: [[51, 130, 30, 6], [201, 245, 14, 0], [1286, 250, 14, 0], [1411, 240, 34, 7], [1501, 495, 16, 0], [1486, 984, 30, 6]],
    coords: [78, 105], tags: [219, 232], gps: [1442, 211], foot: [37, 972], coords2: [1301, 976],
  },
}

/* Живой декор страницы «Анализ».
   • Параллакс: слои сдвигаются от курсора, ближние сильнее (--mx/--my, 0…±1).
   • Камни и кубы медленно «дышат» — невесомость, как в макете.
   • Светлая тема: курсор — источник света, тени камней уходят от него.
   • Тёмная тема: курсор — фонарь, камни рядом с ним проявляются.
   • Пыль в воздухе (canvas), ближе к курсору ярче.
   • Когда панель выбора растягивается или раскрывается, камни у её краёв
     расступаются (--open через data-picker у .ks-scope).
   Всё двигается только transform/opacity; при prefers-reduced-motion стоит. */

function Piece({ p, dark, idx }) {
  const { s, x, y, w, r = 0, f, z = .6, rest, cube, peb, wide } = p
  const cx = x + w / 2
  const side = cx < HALF ? -1 : 1
  // сдвиг при раскрытии панели: сильнее у камней ближе к её краю и ниже шапки
  const near = y > 250 ? 1 : y > 150 ? .5 : .25
  const push = side * (10 + 16 * z) * near
  const img = { transform: `rotate(${r}deg)${f ? ' scaleX(-1)' : ''}` }
  const dur = (cube ? 7 : 9) + ((idx * 7) % 5)
  return (
    <span
      className={'ks-p' + (cube ? ' is-cube' : '') + (rest ? ' is-rest' : '') + (peb ? ' is-peb' : '') + (wide ? ' is-wide' : '')}
      style={{ left: x, top: y, width: w, '--z': z, '--push': `${push.toFixed(1)}px` }}
      data-cx={cx} data-cy={y + w * .45} data-z={z}
    >
      {!dark && !peb && <span className="ks-p__sh" data-sh=""><img src={url(s)} alt="" style={img} draggable="false" /></span>}
      <span className="ks-p__float" style={{ animationDuration: `${dur}s`, animationDelay: `${-(idx * 1.7) % dur}s` }}>
        <img className="ks-rock" src={url(s)} alt="" style={img} draggable="false" decoding="async" />
      </span>
    </span>
  )
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

function useLife(root, canvas, dark) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const light = el.querySelector('.ks-decor__light')
    const shadows = [...el.querySelectorAll('[data-sh]')].map((sh) => {
      const p = sh.parentElement
      return { sh, cx: +p.dataset.cx, cy: +p.dataset.cy, z: +p.dataset.z }
    })
    const st = { tx: 0, ty: 0, mx: 0, my: 0, px: -9999, py: -9999, raf: 0, visible: true, t0: performance.now() }

    // ── пыль ──
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    let parts = [], W = 0, H = 0
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5)
    const resize = () => {
      if (!cv) return
      W = el.clientWidth; H = el.clientHeight
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR)
      cv.style.width = W + 'px'; cv.style.height = H + 'px'
      const n = Math.round((W * H) / (dark ? 17000 : 24000))
      const rnd = (a, b) => a + Math.random() * (b - a)
      parts = Array.from({ length: n }, () => {
        const z = rnd(.15, 1)
        return { x: rnd(0, W), y: rnd(0, H), z, r: rnd(.45, 1.5) * (.6 + z), vx: rnd(-.05, .05), vy: -rnd(.02, .09) * z, a: rnd(.12, .5), w: rnd(.4, 1.6), ph: rnd(0, 6.3) }
      })
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(el)

    const drawDust = (t, dt) => {
      if (!ctx) return
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const col = dark ? '236,229,212' : '96,80,52'
      for (const p of parts) {
        if (!reduce) {
          p.x += (p.vx + Math.sin(t * .0003 * p.w + p.ph) * .04) * dt
          p.y += p.vy * dt
          if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W }
          if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4
        }
        const x = p.x - st.mx * p.z * 26, y = p.y - st.my * p.z * 16
        let a = p.a * (.55 + .45 * Math.sin(t * .0012 * p.w + p.ph))
        if (dark) { const d2 = (x - st.px) ** 2 + (y - st.py) ** 2; a *= 1 + 2.2 * Math.exp(-d2 / 52000) }
        else a *= .7
        ctx.fillStyle = `rgba(${col},${Math.min(.9, a).toFixed(3)})`
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.2832); ctx.fill()
      }
    }

    const apply = () => {
      el.style.setProperty('--mx', st.mx.toFixed(4))
      el.style.setProperty('--my', st.my.toFixed(4))
      if (light) light.style.transform = `translate3d(${(st.px - 600).toFixed(1)}px, ${(st.py - 600).toFixed(1)}px, 0)`
      if (shadows.length) {
        const off = (el.clientWidth / 2) - HALF      // холст центрирован
        for (const s of shadows) {
          const vx = s.cx + off - st.px, vy = s.cy - st.py
          const d = Math.hypot(vx, vy) || 1
          const k = (5 + 9 * s.z) / (1 + d / 520)
          const ox = (vx / d) * k, oy = (vy / d) * k + 5 + 5 * s.z
          s.sh.style.transform = `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0)`
        }
      }
    }

    let prev = performance.now()
    const loop = (now) => {
      st.raf = 0
      if (!st.visible || document.hidden) return
      const dt = Math.min(3, (now - prev) / 16.7); prev = now
      const k = 1 - Math.pow(1 - .16, dt)           // сглаживание без «вязкости»
      st.mx += (st.tx - st.mx) * k; st.my += (st.ty - st.my) * k
      apply()
      drawDust(now, dt)
      if (!reduce) st.raf = requestAnimationFrame(loop)
    }
    const kick = () => { if (!st.raf && st.visible && !document.hidden) { prev = performance.now(); st.raf = requestAnimationFrame(loop) } }

    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      st.px = e.clientX - r.left; st.py = e.clientY - r.top
      st.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1))
      st.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1))
      el.classList.add('has-pointer')
      kick()
    }
    const onLeave = () => { st.tx = 0; st.ty = 0; el.classList.remove('has-pointer'); kick() }
    if (fine && !reduce) {
      window.addEventListener('pointermove', onMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
    }
    const io = new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; if (st.visible) kick() })
    io.observe(el)
    const onVis = () => kick()
    document.addEventListener('visibilitychange', onVis)
    // первый кадр: тени и пыль на местах даже без движения мыши
    st.px = el.clientWidth / 2; st.py = -300
    if (reduce) { apply(); drawDust(performance.now(), 0) } else kick()

    return () => {
      cancelAnimationFrame(st.raf)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      io.disconnect(); ro.disconnect()
    }
  }, [root, canvas, dark])
}

export default function AnalyzeDecor({ theme = 'light' }) {
  const dark = theme === 'dark'
  const root = useRef(null)
  const dust = useRef(null)
  useLife(root, dust, dark)
  const wide = (dark ? DARK_WIDE : LIGHT_WIDE).map((p) => ({ ...p, wide: 1 }))
  const rocks = dark ? [...DARK_ROCKS, ...DARK_REST.map((p) => ({ ...p, rest: 1 })), ...wide] : [...LIGHT_ROCKS, ...wide]
  const M = MARKS[dark ? 'dark' : 'light']

  return (
    <div ref={root} className={'ks-decor' + (dark ? ' is-dark' : ' is-light')} aria-hidden>
      <div className="ks-decor__canvas">
        {/* дальний план: подложка и геодезическая разметка — двигаются вместе */}
        <div className="ks-decor__far">
          {dark && <div className="ks-decor__plate" style={{ backgroundImage: `url(${url('plate-dark')})` }} />}
          {dark && <div className="ks-decor__fog" />}
        </div>
        {rocks.map((p, i) => <Piece key={p.s + i} p={p} dark={dark} idx={i} />)}
        {/* геодезическая разметка — поверх камней, двигается вместе с подложкой */}
        <div className="ks-decor__far ks-decor__marks">
          {M.cross.map(([x, y, size, ring], i) => <Cross key={i} x={x} y={y} size={size} ring={ring} />)}
          <div className="ks-mark ks-mark--coords" style={{ left: M.coords[0], top: M.coords[1] }}>61.7956° N<br />34.3686° E</div>
          <div className="ks-mark ks-mark--tags" style={{ left: M.tags[0], top: M.tags[1] }}>
            <span className="ks-mark__tri">▸</span>
            <span>Фотограмметрия<br />3D-реконструкция<br />Объём / вес</span>
          </div>
          <div className="ks-mark ks-mark--foot" style={{ left: M.foot[0], top: M.foot[1] }}><span className="ks-mark__brand">Карелия Строй</span><br />Точные данные. Реальные объекты.</div>
          <div className="ks-mark ks-mark--gps" style={{ left: M.gps[0], top: M.gps[1] }}>GPS / ARKit<br />Точность<br />±1.5%</div>
          <div className="ks-mark ks-mark--coords2" style={{ left: M.coords2[0], top: M.coords2[1] }}>61.7956° N&nbsp;&nbsp;&nbsp;34.3686° E</div>
        </div>
      </div>
      {dark && <div className="ks-decor__light" />}
      <canvas ref={dust} className="ks-decor__dust" />
    </div>
  )
}
