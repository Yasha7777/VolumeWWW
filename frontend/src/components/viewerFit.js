// ============================================================
// viewerFit — чем наводить камеру 3D-обозревателя.
//
// ЛЁГКИЙ модуль без three: только арифметика, проверяется в node.
//
// Зачем. Раньше камера и сетка считались по полному ограничивающему
// параллелепипеду модели. В облаке DUSt3R почти всегда есть «улёты» —
// единичные точки далеко в стороне (небо, блики, край кадра). Десяток
// таких точек раздувал параллелепипед в разы, и сама куча оказывалась
// пятнышком в центре большого чёрного поля. Теперь границы берутся по
// основной массе точек (перцентили по каждой оси): улёты остаются в
// сцене, но масштаб вида по ним не выбирается.
// ============================================================

const AXES = 3

// Перцентиль по уже отсортированному массиву (линейная интерполяция).
function quantile(sorted, q) {
  const n = sorted.length
  if (!n) return NaN
  const pos = Math.min(Math.max(q, 0), 1) * (n - 1)
  const i = Math.floor(pos)
  const frac = pos - i
  return i + 1 < n ? sorted[i] + (sorted[i + 1] - sorted[i]) * frac : sorted[i]
}

/**
 * Границы основной массы точек.
 *
 * positions — плоский массив [x0,y0,z0, x1,y1,z1, …] (Float32Array или обычный).
 * lo/hi     — какие доли по каждой оси считать основной массой;
 * pad       — запас от найденного размаха в каждую сторону (перцентиль
 *             срезает и честный край кучи — запас его возвращает);
 * Результат никогда не выходит за настоящие min/max: на чистом облаке
 * без улётов он просто совпадает с полными границами.
 *
 * Возвращает { min, max, center, size, radius } или null, если пригодных
 * точек нет: первые четыре — массивы из трёх чисел, radius — радиус
 * основной массы в плане (вокруг вертикали Y).
 */
export function robustBounds(positions, {
  lo = 0.02, hi = 0.98, pad = 0.12, maxSamples = 40000,
} = {}) {
  const count = Math.floor(((positions && positions.length) || 0) / AXES)
  if (!count) return null

  const step = Math.max(1, Math.ceil(count / maxSamples))
  const cols = [[], [], []]
  const full = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }

  for (let i = 0; i < count; i += step) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    const p = [x, y, z]
    for (let a = 0; a < AXES; a++) {
      cols[a].push(p[a])
      if (p[a] < full.min[a]) full.min[a] = p[a]
      if (p[a] > full.max[a]) full.max[a] = p[a]
    }
  }
  if (!cols[0].length) return null

  const min = [0, 0, 0], max = [0, 0, 0], center = [0, 0, 0], size = [0, 0, 0]
  for (let a = 0; a < AXES; a++) {
    const sorted = Float64Array.from(cols[a]).sort()
    const qLo = quantile(sorted, lo)
    const qHi = quantile(sorted, hi)
    const span = qHi - qLo
    min[a] = Math.max(full.min[a], qLo - span * pad)
    max[a] = Math.min(full.max[a], qHi + span * pad)
    center[a] = (min[a] + max[a]) / 2
    size[a] = max[a] - min[a]
  }

  // Радиус в плане (Y — вверх): расстояние от центра, в которое
  // укладывается основная масса точек. Для круглой в плане кучи он
  // заметно меньше половины диагонали прямоугольника — камера встаёт ближе.
  const dists = new Float64Array(cols[0].length)
  for (let i = 0; i < dists.length; i++) {
    dists[i] = Math.hypot(cols[0][i] - center[0], cols[2][i] - center[2])
  }
  dists.sort()
  const radius = Math.min(
    quantile(dists, hi) * (1 + pad),
    0.5 * Math.hypot(size[0], size[2]),
  )
  return { min, max, center, size, radius }
}

/**
 * С какого расстояния модель целиком видна в кадре.
 *
 * radius — радиус модели в плане, height — её высота (центр модели в
 *          начале координат, Y — вверх);
 * dir    — единичный вектор от центра модели к камере;
 * fovDeg — вертикальный угол камеры, aspect — ширина / высота холста.
 *
 * Модель медленно вращается вокруг вертикали, поэтому вписываем цилиндр
 * вокруг неё: что влезло при одном повороте, влезет при любом. Считаем честно по перспективе, для ширины и высоты
 * кадра отдельно: блок обозревателя вытянут (на ноутбуке ~2.7 : 1), и
 * прежняя прикидка «по шару» оставляла модель пятном в середине.
 */
export function fitDistance(radius, height, dir, fovDeg, aspect = 1) {
  radius = radius > 0 ? radius : 0
  const halfY = height > 0 ? 0.5 * height : 0
  if (!(radius > 0) && !(halfY > 0)) return 1

  const tanV = Math.tan((fovDeg * Math.PI) / 360)
  const tanH = tanV * (aspect > 0 ? aspect : 1)

  // Базис камеры: f — от камеры к центру, r — вправо, u — вверх кадра.
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const f = [-dir[0] / dl, -dir[1] / dl, -dir[2] / dl]
  let r = [-f[2], 0, f[0]]                       // f × (0,1,0)
  const rl = Math.hypot(r[0], r[2])
  r = rl > 1e-9 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0]   // камера строго сверху
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]

  let dist = 0
  const STEPS = 24
  for (let k = 0; k < STEPS; k++) {
    const a = (k / STEPS) * Math.PI * 2
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius
    for (const y of [-halfY, halfY]) {
      const right = x * r[0] + y * r[1] + z * r[2]
      const upv = x * u[0] + y * u[1] + z * u[2]
      const depth = x * f[0] + y * f[1] + z * f[2]     // > 0 — дальше центра
      dist = Math.max(dist, Math.abs(right) / tanH - depth, Math.abs(upv) / tanV - depth)
    }
  }
  return dist > 0 ? dist : 1
}

/**
 * Размер точки облака в единицах сцены.
 *
 * Модель без масштаба приходит в произвольных единицах, поэтому
 * фиксированный размер (как было — 0.006) давал то сплошную кашу, то
 * пыль. Берём шаг между соседними точками на поверхности: размах /
 * √(число точек) — и держим его в разумных пределах от размера модели.
 */
export function pointSizeFor(extent, count) {
  const L = extent > 0 ? extent : 1
  const n = count > 0 ? count : 1
  const size = (1.7 * L) / Math.sqrt(n)
  return Math.min(Math.max(size, L * 0.0016), L * 0.02)
}

/** «Круглый» шаг сетки (1·2·5 × 10ⁿ) около заданного. */
export function niceStep(raw) {
  if (!(raw > 0)) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / pow
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow
}
