import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuildInfo } from '../scripts/build-info.js'

test('build identity includes version, source commit, timestamp and worktree state', () => {
  const before = Date.now()
  const info = createBuildInfo()
  assert.equal(info.version, '1.1.0')
  assert.match(info.revision, /^[a-f0-9]{40}$/)
  assert.equal(typeof info.dirty, 'boolean')
  assert.ok(Date.parse(info.builtAt) >= before)
  assert.equal(info.buildId, `${info.version}/${info.revision.slice(0, 12)}/${info.builtAt}`)
})
