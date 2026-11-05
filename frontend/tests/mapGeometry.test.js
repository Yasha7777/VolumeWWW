import test from 'node:test'
import assert from 'node:assert/strict'
import { fitTrack } from '../src/components/obhod/mapGeometry.js'

for (const [width, height] of [[539, 488], [360, 320], [760, 320]]) {
  test(`route and metre bar share CSS pixels at ${width}x${height}`, () => {
    const fit = fitTrack([[0, 0], [10, 0], [10, 20], [0, 20]], width, height)
    const dx = fit.pts[1][0] - fit.pts[0][0]
    const dz = fit.pts[2][1] - fit.pts[1][1]
    assert.ok(Math.abs(dx / fit.bar.len * fit.bar.label - 10) < 1e-9)
    assert.ok(Math.abs(dz / fit.bar.len * fit.bar.label - 20) < 1e-9)
    assert.ok(fit.pts.every(([x, y]) => x >= 0 && x <= width && y >= 0 && y <= height))
  })
}
