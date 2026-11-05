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

