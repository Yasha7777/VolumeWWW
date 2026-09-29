import { useEffect, useRef } from 'react'

/* «Жидкая» плашка выбора обхода.
   Контур плашки рисует SVG: при наведении плашка плавно растягивается вширь,
   а её края стекают вниз двумя каплями — слева (карта и 3D) и справа
   (раскрыть). Центр с заголовком не трогаем. Капли на пружинах с лёгким
   перелётом, правая чуть запаздывает — движение выглядит вязким, а не
   механическим. Всё пишется напрямую в атрибуты SVG, без перерисовки React. */

export const DRIP = 46          // глубина капли в покое наведения, px
const R = 16                    // радиус углов плашки

// ширина капли — доля ширины плашки
export const dripWidth = (W) => Math.max(150, Math.min(290, W * 0.2))

// контур: скруглённый прямоугольник W×H, снизу по краям — капли глубиной dl/dr.
// Капля сужается книзу: у плашки она шириной dw, внизу — ~0.6·dw, внутренний
// край — плавная S-кривая, как у стекающей вязкой жидкости; дно чуть провисает.
export function liquidPath(W, H, dl, dr) {
  const dw = dripWidth(W)
  const n = (v) => v.toFixed(1)
  // низ капли: дно уже верха на s px; внутренний край — S-кривая с
  // горизонтальными касательными на концах (ручки по s/2 — без петель)
  const drop = (d) => {
    const k = Math.min(1.15, d / DRIP)
    const s = 6 + dw * 0.4 * k
    return { on: d >= 0.4, B: H + d, s, h: s * 0.5, belly: d * 0.12 }
  }
  const P = drop(dr), L = drop(dl)
  const out = [`M${R},0H${n(W - R)}A${R},${R} 0 0 1 ${n(W)},${R}`]
  if (P.on) {
    const xa = W - dw, xb = xa + P.s              // верх и низ внутреннего края правой капли
    out.push(
      `V${n(P.B - R)}A${R},${R} 0 0 1 ${n(W - R)},${n(P.B)}`,
      `Q${n((W - R + xb) / 2)},${n(P.B + P.belly)} ${n(xb)},${n(P.B)}`,
      `C${n(xb - P.h)},${n(P.B)} ${n(xa + P.h)},${H} ${n(xa)},${H}`,
    )
  } else {
    out.push(`V${H - R}A${R},${R} 0 0 1 ${W - R},${H}`)
  }
  if (L.on) {
    const xa = dw, xb = xa - L.s                  // верх и низ внутреннего края левой капли
    out.push(
      `H${n(xa)}`,                                  // низ плашки между каплями — прямой: центр не шевелится
      `C${n(xa - L.h)},${H} ${n(xb + L.h)},${n(L.B)} ${n(xb)},${n(L.B)}`,
      `Q${n((xb + R) / 2)},${n(L.B + L.belly)} ${R},${n(L.B)}`,
      `A${R},${R} 0 0 1 0,${n(L.B - R)}`,
    )
  } else {
    out.push(`H${R}A${R},${R} 0 0 1 0,${H - R}`)
  }
  out.push(`V${R}A${R},${R} 0 0 1 ${R},0Z`)
  return out.join('')
}

// пружина: k — жёсткость, c — затухание (c < 2√k — с перелётом)
function stepSpring(s, target, k, c, dt) {
  const a = -k * (s.x - target) - c * s.v
  s.v += a * dt
  s.x += s.v * dt
  if (s.x < 0) { s.x = 0; if (s.v < 0) s.v = 0 }
}

export function useLiquid({ box, paths, state, enabled, reduce }) {
  const st = useRef({ l: { x: 0, v: 0 }, r: { x: 0, v: 0 }, raf: 0, last: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const s = st.current
    const drip = state === 'hover' && enabled && !reduce
    const t0 = performance.now()
    const until = t0 + 1500            // ширину анимирует motion — рисуем, пока она идёт

    const draw = () => {
      const W = el.offsetWidth, H = el.offsetHeight
      const d = liquidPath(W, H, s.l.x, s.r.x)
      for (const p of paths) p.current?.setAttribute('d', d)
      el.style.setProperty('--dl', (s.l.x / DRIP).toFixed(3))
      el.style.setProperty('--dr', (s.r.x / DRIP).toFixed(3))
      el.style.setProperty('--dw', `${dripWidth(W).toFixed(0)}px`)
    }
    const tick = (now) => {
      s.raf = 0
      const dt = Math.min(0.034, (now - (s.last || now)) / 1000); s.last = now
      const age = now - t0
      if (drip) {
        // капли начинают стекать, когда плашка уже заметно раздалась
        stepSpring(s.l, age > 150 ? DRIP : 0, 150, 11, dt)
        stepSpring(s.r, age > 220 ? DRIP * 0.9 : 0, 140, 10.5, dt)
      } else {
        // втягиваются быстро и без отскока
        stepSpring(s.l, 0, 420, 38, dt)
        stepSpring(s.r, 0, 420, 38, dt)
      }
      draw()
      const moving = Math.abs(s.l.v) + Math.abs(s.r.v) > 0.3 || (drip && (Math.abs(s.l.x - DRIP) > 0.3))
      if (now < until || moving) s.raf = requestAnimationFrame(tick)
    }
    if (reduce) { s.l.x = s.r.x = 0; draw(); return }
    cancelAnimationFrame(s.raf)
    s.last = 0
    s.raf = requestAnimationFrame(tick)

    // размер окна поменялся — перерисовать контур
    const ro = new ResizeObserver(() => { if (!s.raf) draw() })
    ro.observe(el)
    return () => { cancelAnimationFrame(s.raf); s.raf = 0; ro.disconnect() }
  }, [state, enabled, reduce]) // eslint-disable-line react-hooks/exhaustive-deps
}
