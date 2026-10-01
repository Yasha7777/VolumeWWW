/* Поверхность кучи по разреженным точкам ARKit (VIO) — в браузере, без сервера.

   Те же четыре шага, что и в разовой обработке на numpy/scipy:
   1. точки уже собраны со всех кадров без повторов (build_cloud на бэкенде);
   2. плоскость земли — RANSAC по «нижней огибающей» (самые низкие точки
      в клетках 0.5 м), только почти горизонтальные плоскости: ARKit даёт y
      по гравитации, так что крутой склон — это бок кучи, а не земля;
   3. высоты над плоскостью раскладываем в сетку (медиана в клетке) и
      затягиваем пустые клетки нормированной свёрткой (гаусс с растущим
      радиусом) — это и есть «натянуть поверхность между точками»;
   4. объём = Σ высот × площадь клетки. ARKit в метрах, поэтому сразу м³.

   Точки разреженные (≤6000, в основном на текстурных местах), так что
   объём — предварительная оценка, а не замер. */

const quantile = (arr, q) => {
  if (!arr.length) return 0
  const s = Float64Array.from(arr).sort()
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

// детерминированный ГСЧ — чтобы поверхность не «прыгала» между открытиями
function rng(seed = 12345) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/* Плоскость y = a·x + b·z + c (метры). */
export function fitGround(points, { cell = 0.5, thr = 0.06, maxTiltDeg = 12 } = {}) {
  // нижняя огибающая: 10-й перцентиль y в каждой клетке 0.5 м
  const bins = new Map()
  for (const p of points) {
    const k = Math.floor(p[0] / cell) + ':' + Math.floor(p[2] / cell)
    let b = bins.get(k); if (!b) bins.set(k, (b = []))
    b.push(p)
  }
  const samples = []
  for (const b of bins.values()) {
    if (b.length < 2) continue
    const ys = b.map((p) => p[1])
    const y = quantile(ys, 0.1)
    // берём настоящую точку, ближайшую к перцентилю (x,z реальные)
    let best = b[0], d = Infinity
    for (const p of b) { const e = Math.abs(p[1] - y); if (e < d) { d = e; best = p } }
    samples.push(best)
  }
  const flatY = quantile(points.map((p) => p[1]), 0.04)
  if (samples.length < 6) return { a: 0, b: 0, c: flatY, inliers: 0, samples: samples.length }

  const maxSlope = Math.tan((maxTiltDeg * Math.PI) / 180)
  const rand = rng()
  let best = null
  for (let it = 0; it < 400; it++) {
    const i = Math.floor(rand() * samples.length)
    let j = Math.floor(rand() * samples.length), k = Math.floor(rand() * samples.length)
    if (i === j || j === k || i === k) continue
    const P = samples[i], Q = samples[j], R = samples[k]
    // плоскость через 3 точки: решаем [x z 1]·[a b c] = y
    const m = solve3([[P[0], P[2], 1], [Q[0], Q[2], 1], [R[0], R[2], 1]], [P[1], Q[1], R[1]])
    if (!m || Math.hypot(m[0], m[1]) > maxSlope) continue
    let n = 0, below = 0
    for (const s of samples) {
      const r = s[1] - (m[0] * s[0] + m[1] * s[2] + m[2])
      if (Math.abs(r) < thr) n++
      else if (r < -thr) below++
    }
    // земля — то, ниже чего почти ничего нет; при равенстве — нижняя
    const score = n - 2 * below
    if (!best || score > best.score || (score === best.score && m[2] < best.m[2])) best = { m, score, n }
  }
  if (!best) return { a: 0, b: 0, c: flatY, inliers: 0, samples: samples.length }

  // уточнение МНК по инлаерам
  const inl = samples.filter((s) => Math.abs(s[1] - (best.m[0] * s[0] + best.m[1] * s[2] + best.m[2])) < thr)
  let m = best.m
  if (inl.length >= 3) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0]
    for (const s of inl) {
      const r = [s[0], s[2], 1]
      for (let u = 0; u < 3; u++) { v[u] += r[u] * s[1]; for (let w = 0; w < 3; w++) A[u][w] += r[u] * r[w] }
    }
    const ls = solve3(A, v)
    if (ls && Math.hypot(ls[0], ls[1]) <= maxSlope) m = ls
  }
  // огибающая сидит чуть ниже земли (берём 10-й перцентиль) — сдвигаем
  // плоскость на медиану остатков всех точек, лежащих возле неё
  const res = []
  for (const p of points) { const r = p[1] - (m[0] * p[0] + m[1] * p[2] + m[2]); if (Math.abs(r) < thr) res.push(r) }
  const c = m[2] + (res.length > 20 ? quantile(res, 0.5) : 0)
  return { a: m[0], b: m[1], c, inliers: inl.length, samples: samples.length }
}

function solve3(A, y) {
  const d = det3(A)
  if (Math.abs(d) < 1e-12) return null
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? y[i] : v)))
  return [det3(col(0)) / d, det3(col(1)) / d, det3(col(2)) / d]
}
function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

/* Нормированная свёртка: blur(v·w)/blur(w). Сепарабельный гаусс. */
function blur(src, nx, nz, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5))
  const k = []; let ks = 0
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); ks += v }
  const tmp = new Float32Array(nx * nz), out = new Float32Array(nx * nz)
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < nx) s += src[z * nx + xx] * k[i + r] }
    tmp[z * nx + x] = s
  }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) { const zz = z + i; if (zz >= 0 && zz < nz) s += tmp[zz * nx + x] * k[i + r] }
    out[z * nx + x] = s
  }
  return out
}

/* points — метры (x, y вверх, z). Возвращает плоскость, сетку высот (м)
   и маску клеток, где поверхность опирается на данные. */
export function buildSurface(points, { maxCells = 84, minCell = 0.05, groundEps = 0.05 } = {}) {
  const n = points.length
  if (n < 30) return null
  const plane = fitGround(points)
  const H = (p) => p[1] - (plane.a * p[0] + plane.b * p[2] + plane.c)

  // область: вокруг медианного центра, до 97-го перцентиля радиуса
  const cx = quantile(points.map((p) => p[0]), 0.5), cz = quantile(points.map((p) => p[2]), 0.5)
  const R = quantile(points.map((p) => Math.hypot(p[0] - cx, p[2] - cz)), 0.97) * 1.05 || 1
  const cell = Math.max(minCell, (2 * R) / maxCells)
  const nx = Math.ceil((2 * R) / cell) + 1, nz = nx
  const x0 = cx - ((nx - 1) * cell) / 2, z0 = cz - ((nz - 1) * cell) / 2

  const cellOf = (p) => {
    const ix = Math.round((p[0] - x0) / cell), iz = Math.round((p[2] - z0) / cell)
    return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? -1 : iz * nx + ix
  }
  // 1) медиана высот в клетке → 2) затягиваем: узкое ядро сглаживает шум,
  // дыры затягиваются ядром всё шире. Два прохода: после первого выкидываем
  // одиночные «вылеты» VIO (дальше 15 см от поверхности) — иначе пупырышки.
  let keep = points.map(() => true), h, w, filled
  for (let pass = 0; pass < 2; pass++) {
    const buckets = Array.from({ length: nx * nz }, () => null)
    points.forEach((p, i) => {
      if (!keep[i]) return
      const k = cellOf(p); if (k < 0) return
      ;(buckets[k] || (buckets[k] = [])).push(H(p))
    })
    const val = new Float32Array(nx * nz); w = new Float32Array(nx * nz); filled = 0
    for (let k = 0; k < buckets.length; k++) {
      const b = buckets[k]; if (!b) continue
      val[k] = quantile(b, 0.5) * Math.min(3, b.length); w[k] = Math.min(3, b.length); filled++
    }
    h = new Float32Array(nx * nz).fill(NaN)
    for (const s of [1.2, 2.5, 5, 10]) {
      const bv = blur(val, nx, nz, s), bw = blur(w, nx, nz, s)
      for (let k = 0; k < h.length; k++) if (Number.isNaN(h[k]) && bw[k] > 0.15) h[k] = bv[k] / bw[k]
    }
    if (pass === 0) keep = points.map((p) => { const k = cellOf(p); return k < 0 || Number.isNaN(h[k]) || Math.abs(H(p) - h[k]) < 0.15 })
  }
  // данные рядом (≤ ~0.9 м) — иначе это не куча, а пустота за обходом
  const gapCells = Math.max(3, Math.round(0.9 / cell))
  const near = blur(w.map((v) => (v > 0 ? 1 : 0)), nx, nz, gapCells / 2.5)
  let vol = 0, area = 0, top = 0
  for (let k = 0; k < h.length; k++) {
    let v = Number.isNaN(h[k]) || near[k] <= 0.02 ? 0 : h[k]
    if (v < groundEps) v = 0
    h[k] = v
    if (v > 0) { vol += v * cell * cell; area += cell * cell; if (v > top) top = v }
  }
  // рисуем кучу и полосу земли ~0.7 м вокруг неё — без квадратной «плиты»
  const ring = Math.max(2, Math.round(0.7 / cell))
  const pile = blur(h.map((v) => (v > 0 ? 1 : 0)), nx, nz, ring / 2)
  const mask = new Uint8Array(nx * nz)
  for (let k = 0; k < h.length; k++) mask[k] = pile[k] > 0.01 && near[k] > 0.02 ? 1 : 0
  return { plane, nx, nz, cell, x0, z0, h, mask, volume: vol, area, top, filledCells: filled }
}
