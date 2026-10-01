/* Поверхность кучи по разреженным точкам ARKit (VIO) — в браузере, без сервера.

   1. Область кучи — внутри петли обхода (выпуклая оболочка позиций камеры).
      Всё, что снаружи, — фон: деревья, стены, соседние кучи. В объём не идёт.
   2. Земля — по тому, где ходил человек. Траектория камеры почти плоская
      (телефон на одной высоте над землёй), поэтому её плоскость даёт НАКЛОН
      земли, а точки трекинга возле траектории — СДВИГ вниз (высоту телефона).
      Без траектории — RANSAC по нижней огибающей, как раньше.
   3. Поверхность — триангуляция Делоне по точкам (медиана в мелкой клетке)
      + кольцо нулевых высот по петле обхода: под ногами — земля, поэтому
      склоны сходят к нулю, а не обрываются стенкой. Внутри треугольников —
      линейная интерполяция (то же, что scipy griddata linear), сверху —
      лёгкое сглаживание.
   4. Объём = Σ высот × площадь клетки; ARKit в метрах, значит сразу м³.
      Разброс — от неточности земли (её сдвиг на ±δ меняет объём на ≈ S·δ). */

const quantile = (arr, q) => {
  if (!arr.length) return 0
  const s = Float64Array.from(arr).sort()
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function rng(seed = 12345) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function solve3(A, y) {
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const d = det3(A)
  if (Math.abs(d) < 1e-12) return null
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? y[i] : v)))
  return [det3(col(0)) / d, det3(col(1)) / d, det3(col(2)) / d]
}
// МНК-плоскость y = a·x + b·z + c
function lsq(pts) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0]
  for (const p of pts) {
    const r = [p[0], p[2], 1]
    for (let u = 0; u < 3; u++) { v[u] += r[u] * p[1]; for (let w = 0; w < 3; w++) A[u][w] += r[u] * r[w] }
  }
  return solve3(A, v)
}

/* ── геометрия на плоскости XZ ─────────────────────────────────────────── */
function convexHull(pts) {           // pts: [[x,z]] → против часовой
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], up = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}
function insideConvex(hull, x, z) {
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false
  }
  return true
}
function distToPath(path, x, z) {
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b[0] - a[0], dz = b[1] - a[1]
    const L = dx * dx + dz * dz
    const t = L ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1) : 0
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz))
  }
  return best
}

/* ── земля ─────────────────────────────────────────────────────────────── */

// Самый плотный слой толщиной 16 см среди нижних 60 % значений → его медиана.
function lowLayer(vals) {
  if (vals.length < 8) return null
  const r = vals.slice().sort((a, b) => a - b)
  const half = r.slice(0, Math.max(6, Math.ceil(r.length * 0.6)))
  let best = null
  for (let i = 0; i < half.length; i++) {
    let n = 0; for (let j = i; j < half.length && half[j] - half[i] <= 0.16; j++) n++
    if (!best || n > best.n) best = { i, n }
  }
  const layer = half.slice(best.i, best.i + best.n)
  const med = quantile(layer, 0.5)
  return { med, mad: quantile(layer.map((v) => Math.abs(v - med)), 0.5) * 1.4826, n: layer.length }
}

// По траектории: наклон — плоскость камеры, сдвиг — точки у ног.
function groundFromPath(points, cams, R) {
  if (cams.length < 12) return null
  const tilt = lsq(cams)
  if (!tilt) return null
  const res = cams.map((c) => c[1] - (tilt[0] * c[0] + tilt[1] * c[2] + tilt[2]))
  const camStd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length)
  // телефон гулял по высоте больше 25 см или земля круче ~10° — не верим
  if (camStd > 0.25 || Math.hypot(tilt[0], tilt[1]) > 0.18) return null
  const path = cams.map((c) => [c[0], c[2]])
  const D = clamp(0.3 * R, 1, 3)
  const r = []
  for (const p of points) {
    if (distToPath(path, p[0], p[2]) < D) r.push(p[1] - (tilt[0] * p[0] + tilt[1] * p[2] + tilt[2]))
  }
  // земля — самый НИЖНИЙ заметный слой точек у ног, на правдоподобной
  // высоте телефона 0,8–2,2 м. Не самый плотный: в помещении самый плотный
  // слой — столешница, а пол у ног почти не попадает в кадр.
  const cand = r.filter((v) => v <= -0.8 && v >= -2.2).sort((x, y) => x - y)
  if (cand.length < 5) return null
  const win = cand.map((v, i) => { let n = 0; for (let j = i; j < cand.length && cand[j] - v <= 0.16; j++) n++; return n })
  // первый снизу слой, где есть хоть сколько-то точек (≥5 и ≥3 %), затем
  // самое плотное окно в пределах 16 см над ним — это и есть земля
  const need = Math.max(5, 0.03 * cand.length)
  let i0 = win.findIndex((n) => n >= need)
  if (i0 < 0) return null
  for (let i = i0 + 1; i < cand.length && cand[i] - cand[i0] <= 0.16; i++) if (win[i] > win[i0]) i0 = i
  const layer = cand.slice(i0, i0 + win[i0])
  const off = quantile(layer, 0.5), hold = -off
  const sigma = quantile(layer.map((v) => Math.abs(v - off)), 0.5) * 1.4826
  return { a: tilt[0], b: tilt[1], c: tilt[2] + off, source: 'path', hold, camStd, sigma, support: layer.length }
}

// Запасной: RANSAC по нижней огибающей (когда нет нормальной траектории).
function groundFromPoints(points, { cell = 0.5, thr = 0.06, maxTiltDeg = 12 } = {}) {
  const bins = new Map()
  for (const p of points) {
    const k = Math.floor(p[0] / cell) + ':' + Math.floor(p[2] / cell)
    let b = bins.get(k); if (!b) bins.set(k, (b = []))
    b.push(p)
  }
  const samples = []
  for (const b of bins.values()) {
    if (b.length < 2) continue
    const y = quantile(b.map((p) => p[1]), 0.1)
    let best = b[0], d = Infinity
    for (const p of b) { const e = Math.abs(p[1] - y); if (e < d) { d = e; best = p } }
    samples.push(best)
  }
  const flatY = quantile(points.map((p) => p[1]), 0.04)
  const flat = { a: 0, b: 0, c: flatY, source: 'flat', sigma: 0.1 }
  if (samples.length < 6) return flat
  const maxSlope = Math.tan((maxTiltDeg * Math.PI) / 180)
  const rand = rng()
  let best = null
  for (let it = 0; it < 400; it++) {
    const i = Math.floor(rand() * samples.length), j = Math.floor(rand() * samples.length), k = Math.floor(rand() * samples.length)
    if (i === j || j === k || i === k) continue
    const P = samples[i], Q = samples[j], S = samples[k]
    const m = solve3([[P[0], P[2], 1], [Q[0], Q[2], 1], [S[0], S[2], 1]], [P[1], Q[1], S[1]])
    if (!m || Math.hypot(m[0], m[1]) > maxSlope) continue
    let n = 0, below = 0
    for (const s of samples) {
      const r = s[1] - (m[0] * s[0] + m[1] * s[2] + m[2])
      if (Math.abs(r) < thr) n++; else if (r < -thr) below++
    }
    const score = n - 2 * below
    if (!best || score > best.score || (score === best.score && m[2] < best.m[2])) best = { m, score }
  }
  if (!best) return flat
  const inl = samples.filter((s) => Math.abs(s[1] - (best.m[0] * s[0] + best.m[1] * s[2] + best.m[2])) < thr)
  let m = best.m
  const ls = inl.length >= 3 ? lsq(inl) : null
  if (ls && Math.hypot(ls[0], ls[1]) <= maxSlope) m = ls
  const res = []
  for (const p of points) { const r = p[1] - (m[0] * p[0] + m[1] * p[2] + m[2]); if (Math.abs(r) < thr) res.push(r) }
  const off = res.length > 20 ? quantile(res, 0.5) : 0
  return { a: m[0], b: m[1], c: m[2] + off, source: 'points', sigma: 0.08, support: inl.length }
}

/* ── триангуляция Делоне (Боуэр — Ватсон) ─────────────────────────────── */
function delaunay(X, Z) {
  const n = X.length
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]) }
  const d = Math.max(maxX - minX, maxZ - minZ) * 20 || 1, mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2
  const px = Array.from(X).concat([mx - d, mx, mx + d]), pz = Array.from(Z).concat([mz - d, mz + d, mz - d])
  const circ = (a, b, c) => {
    const ax = px[a], az = pz[a], bx = px[b], bz = pz[b], cx = px[c], cz = pz[c]
    const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz))
    if (Math.abs(D) < 1e-14) return { a, b, c, x: 0, z: 0, r2: Infinity }
    const a2 = ax * ax + az * az, b2 = bx * bx + bz * bz, c2 = cx * cx + cz * cz
    const x = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / D
    const z = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D
    return { a, b, c, x, z, r2: (ax - x) ** 2 + (az - z) ** 2 }
  }
  let tris = [circ(n, n + 1, n + 2)]
  for (let i = 0; i < n; i++) {
    const x = px[i], z = pz[i]
    const edges = new Map(), keep = []
    for (const t of tris) {
      if ((x - t.x) ** 2 + (z - t.z) ** 2 < t.r2) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
          const k = u < v ? u + ',' + v : v + ',' + u
          edges.set(k, edges.has(k) ? null : [u, v])
        }
      } else keep.push(t)
    }
    for (const e of edges.values()) if (e) keep.push(circ(e[0], e[1], i))
    tris = keep
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c])
}

/* Нормированная свёртка внутри маски: размывает, не затягивая землю за краем. */
function maskedBlur(src, mask, nx, nz, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 2.5))
  const k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
  const pass = (v, w, horiz) => {
    const ov = new Float32Array(nx * nz), ow = new Float32Array(nx * nz)
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let s = 0, sw = 0
      for (let i = -r; i <= r; i++) {
        const xx = horiz ? x + i : x, zz = horiz ? z : z + i
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue
        const q = zz * nx + xx; s += v[q] * k[i + r]; sw += w[q] * k[i + r]
      }
      ov[z * nx + x] = s; ow[z * nx + x] = sw
    }
    return [ov, ow]
  }
  const v0 = new Float32Array(nx * nz), w0 = new Float32Array(nx * nz)
  for (let q = 0; q < v0.length; q++) if (mask[q]) { v0[q] = src[q]; w0[q] = 1 }
  const [v1, w1] = pass(v0, w0, true), [v2, w2] = pass(v1, w1, false)
  const out = new Float32Array(nx * nz)
  for (let q = 0; q < out.length; q++) out[q] = mask[q] && w2[q] > 1e-6 ? v2[q] / w2[q] : 0
  return out
}

/* points, cameras — метры (x, y вверх, z). */
export function buildSurface(points, cameras = [], { groundEps = 0.05 } = {}) {
  if (!points || points.length < 30) return null
  const cams = (cameras || []).filter((c) => c && c.every(Number.isFinite))

  // 1) область: петля обхода
  let hull = null, closed = false, coverage = 0
  if (cams.length >= 8) {
    hull = convexHull(cams.map((c) => [c[0], c[2]]))
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length, cz = hull.reduce((s, p) => s + p[1], 0) / hull.length
    const ang = cams.map((c) => Math.atan2(c[2] - cz, c[0] - cx)).sort((a, b) => a - b)
    let gap = 2 * Math.PI - (ang[ang.length - 1] - ang[0])
    for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1])
    coverage = 360 - (gap * 180) / Math.PI
    closed = coverage >= 300
  }
  if (!hull || hull.length < 3 || !closed) {
    // петля не замкнута: берём оболочку камер + центральные 90 % точек
    const xs = points.map((p) => p[0]), zs = points.map((p) => p[2])
    const lx = quantile(xs, 0.05), hx = quantile(xs, 0.95), lz = quantile(zs, 0.05), hz = quantile(zs, 0.95)
    const core = points.filter((p) => p[0] >= lx && p[0] <= hx && p[2] >= lz && p[2] <= hz).map((p) => [p[0], p[2]])
    hull = convexHull(core.concat(cams.map((c) => [c[0], c[2]])))
  }
  const hcx = hull.reduce((s, p) => s + p[0], 0) / hull.length, hcz = hull.reduce((s, p) => s + p[1], 0) / hull.length
  const R = quantile(hull.map((p) => Math.hypot(p[0] - hcx, p[1] - hcz)), 0.5) || 1

  // 2) земля
  const plane = groundFromPath(points, cams, R) || groundFromPoints(points)
  const G = (x, z) => plane.a * x + plane.b * z + plane.c

  // 3) узлы: медиана высот в мелкой клетке, только внутри петли
  const inRoi = new Uint8Array(points.length)
  const cellT = clamp(R / 40, 0.04, 0.4)
  const bins = new Map()
  points.forEach((p, i) => {
    if (!insideConvex(hull, p[0], p[2])) return
    inRoi[i] = 1
    const h = p[1] - G(p[0], p[2])
    if (h < -0.3) return                                // глубоко под землёй — шум
    const k = Math.floor(p[0] / cellT) + ':' + Math.floor(p[2] / cellT)
    let b = bins.get(k); if (!b) bins.set(k, (b = { x: 0, z: 0, h: [] }))
    b.x += p[0]; b.z += p[2]; b.h.push(Math.max(0, h))
  })
  const NX = [], NZ = [], NH = [], isData = []
  const seen = new Set()
  const addNode = (x, z, h, data) => {
    const key = Math.round(x / (cellT * 0.3)) + ':' + Math.round(z / (cellT * 0.3))
    if (seen.has(key)) return
    seen.add(key); NX.push(x); NZ.push(z); NH.push(h); isData.push(data)
  }
  for (const b of bins.values()) addNode(b.x / b.h.length, b.z / b.h.length, quantile(b.h, 0.5), true)
  const nData = NX.length
  if (nData < 10) return null
  // кольцо нулей по петле: под ногами — земля
  const step = Math.max(cellT * 2, R / 60)
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step))
    for (let s = 0; s < n; s++) addNode(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n, 0, false)
  }

  const tris = delaunay(NX, NZ)

  // одиночные вылеты VIO: заменяем медианой соседей по треугольникам
  const nb = NX.map(() => new Set())
  for (const [a, b, c] of tris) { nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b) }
  const tau = Math.max(0.25, 0.05 * R)
  const H = NH.slice()
  for (let i = 0; i < NX.length; i++) {
    if (!isData[i] || nb[i].size < 3) continue
    const med = quantile([...nb[i]].map((j) => NH[j]), 0.5)
    if (Math.abs(NH[i] - med) > tau) H[i] = med
  }

  // 4) растр: линейная интерполяция внутри треугольников
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of hull) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]) }
  const cell = Math.max(0.02, Math.max(maxX - minX, maxZ - minZ) / 110)
  const x0 = minX - cell, z0 = minZ - cell
  const nx = Math.ceil((maxX - minX) / cell) + 3, nz = Math.ceil((maxZ - minZ) / cell) + 3
  const lin = new Float32Array(nx * nz), mask = new Uint8Array(nx * nz)
  for (const [a, b, c] of tris) {
    const ax = NX[a], az = NZ[a], bx = NX[b], bz = NZ[b], cx = NX[c], cz = NZ[c]
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(det) < 1e-12) continue
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * cell, z = z0 + j * cell
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
      const l3 = 1 - l1 - l2
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
      const q = j * nx + i
      lin[q] = Math.max(0, l1 * H[a] + l2 * H[b] + l3 * H[c]); mask[q] = 1
    }
  }

  // 5) лёгкое сглаживание (для вида; объём почти не меняет)
  const sm = maskedBlur(lin, mask, nx, nz, Math.max(1.5, (0.025 * R) / cell))
  const vol = (grid, shift = 0) => {
    let v = 0
    for (let q = 0; q < grid.length; q++) if (mask[q]) { const h = grid[q] - shift; if (h > groundEps) v += h * cell * cell }
    return v
  }
  const h = new Float32Array(nx * nz)
  let area = 0, top = 0
  const fx = [], fz = []
  for (let q = 0; q < h.length; q++) {
    const v = mask[q] && sm[q] > groundEps ? sm[q] : 0
    h[q] = v
    if (v > 0) { area += cell * cell; if (v > top) top = v; fx.push(x0 + (q % nx) * cell); fz.push(z0 + Math.floor(q / nx) * cell) }
  }
  const volume = vol(sm)
  const delta = clamp(plane.sigma || 0.08, 0.03, 0.2)
  const vs = [vol(lin), volume, vol(lin, delta), vol(lin, -delta)]
  // Вторая гипотеза земли: плотный нижний слой МЕЖДУ ногами и кучей
  // (полоса 1,5 м … 0,45 R от траектории). Бывает, что куча стоит на
  // подсыпке/отвале, и тогда этот слой — земля; бывает, что это растёкшийся
  // материал. По точкам не различить — показываем оба числа.
  let foot = null
  if (plane.source === 'path' && cams.length >= 12) {
    const path = cams.map((c) => [c[0], c[2]])
    const band = []
    points.forEach((p, i) => {
      if (!inRoi[i]) return
      const d = distToPath(path, p[0], p[2])
      if (d >= 1.5 && d <= Math.max(2, 0.45 * R)) band.push(p[1] - G(p[0], p[2]))
    })
    const L = lowLayer(band)
    if (L && L.med > Math.max(0.12, 2 * delta) && L.med < 0.4 * top) {
      foot = { lift: L.med, volume: vol(sm, L.med), n: L.n }
      vs.push(foot.volume)
    }
  }
  // размеры подошвы по главным осям
  let size = [0, 0]
  if (fx.length > 3) {
    const mx = fx.reduce((s, v) => s + v, 0) / fx.length, mz = fz.reduce((s, v) => s + v, 0) / fz.length
    let sxx = 0, szz = 0, sxz = 0
    for (let i = 0; i < fx.length; i++) { const dx = fx[i] - mx, dz = fz[i] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), c = Math.cos(th), s = Math.sin(th)
    const u = fx.map((x, i) => (x - mx) * c + (fz[i] - mz) * s), w = fx.map((x, i) => -(x - mx) * s + (fz[i] - mz) * c)
    size = [quantile(u, 0.99) - quantile(u, 0.01), quantile(w, 0.99) - quantile(w, 0.01)].sort((a, b) => b - a)
  }
  return {
    plane, hull, inRoi, center: [hcx, hcz], R,
    nx, nz, cell, x0, z0, h, mask,
    volume, volumeRange: [Math.min(...vs), Math.max(...vs)], area, top, size, foot,
    closed, coverage, nodes: nData,
  }
}
