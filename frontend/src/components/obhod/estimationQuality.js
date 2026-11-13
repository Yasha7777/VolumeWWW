// Also protects clients receiving an older backend/cloud.v5 cache.
// These are conservative publication rules, not calibrated accuracy thresholds.
export function estimationWarning(data) {
  if (data?.estimation_warning) return data.estimation_warning
  const s = data?.surface
  if (!s) return null
  if (s.support?.volume_share != null && s.support.volume_share < 0.5) {
    return 'Большая часть модели построена между точками: границы объекта не определены достаточно надёжно. Предобъём не показан. Метод рассчитан на сыпучие кучи; для палет и упаковок с вертикальными стенками нужен отдельный расчёт геометрии.'
  }
  if (s.volume_frames != null && s.volume != null && Math.max(s.volume_frames, s.volume) > 0 &&
      Math.abs(s.volume_frames - s.volume) / Math.max(s.volume_frames, s.volume) > 0.25) {
    return 'Расчёты по двум наборам точек одного обхода заметно расходятся. Предобъём не показан: форма поверхности неустойчива.'
  }
  return null
}
