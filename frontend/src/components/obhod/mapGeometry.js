export const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

/* Траектория ARKit (метры, вид сверху: x вправо, z вниз) → координаты карточки.
   Масштаб честный: линейка внизу считается из того же коэффициента. */
export function fitTrack(points, width = 539, height = 488) {
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const box = { l: 60, r: 60, t: 110, b: 90 }
  const s = Math.min(Math.max(1, width - box.l - box.r) / Math.max(maxX - minX, 0.5), Math.max(1, height - box.t - box.b) / Math.max(maxZ - minZ, 0.5))
  const ox = box.l + ((width - box.l - box.r) - (maxX - minX) * s) / 2
  const oy = box.t + ((height - box.t - box.b) - (maxZ - minZ) * s) / 2
  const map = ([x, z]) => [ox + (x - minX) * s, oy + (z - minZ) * s]
  const pts = points.map(map)
  const L = NICE.find((n) => n * s >= 70) || NICE[NICE.length - 1]
  return { pts, map, pxPerM: s, bar: { len: L * s, label: L } }
}


// Pick a readable physical step, independently of viewport normalization.
export function metricStep(target) {
  if (!(target > 0) || !Number.isFinite(target)) return 1
  const power = 10 ** Math.floor(Math.log10(target))
  return [1, 2, 5, 10].find(n => n * power >= target) * power
}

export function metricGrid(fit, width, height) {
  const stepM = metricStep(36 / fit.pxPerM)
  const stepPx = stepM * fit.pxPerM
  const origin = fit.map([0, 0])
  const lines = (offset, extent) => {
    const start = ((offset % stepPx) + stepPx) % stepPx
    return Array.from({ length: Math.max(0, Math.ceil((extent - start) / stepPx)) }, (_, i) => start + i * stepPx)
  }
  return { stepM, stepPx, xs: lines(origin[0], width), ys: lines(origin[1], height) }
}
