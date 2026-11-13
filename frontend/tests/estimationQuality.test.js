import test from 'node:test'
import assert from 'node:assert/strict'
import { estimationWarning } from '../src/components/obhod/estimationQuality.js'
test('old v5 sparse caches are rejected before rendering a volume', () => {
  assert.ok(estimationWarning({ surface: { volume: 5.505, support: { volume_share: .29 } } }))
  assert.ok(estimationWarning({ surface: { volume: 34.194, support: { volume_share: .288 } } }))
})
test('supported consistent result is preserved', () => {
  assert.equal(estimationWarning({ surface: { volume: 1.419, volume_frames: 1.345, support: { volume_share: .828 } } }), null)
})
test('server rejection and disagreeing estimates remain rejected', () => {
  assert.equal(estimationWarning({ estimation_warning: 'reason' }), 'reason')
  assert.ok(estimationWarning({ surface: { volume: 34, volume_frames: 25, support: { volume_share: .8 } } }))
  assert.equal(estimationWarning(null), null)
})
