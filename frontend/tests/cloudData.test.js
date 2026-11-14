import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudViewData } from '../src/components/obhod/cloudData.js'
import { estimationWarning } from '../src/components/obhod/estimationQuality.js'

test('server-rejected volume remains explained after the cloud adapter', () => {
  const response = {points:[[1,2,3]], cameras:[], surface:null,
    estimation_warning:'Недостаточно опоры на точки',geometry_warning:null}
  const view=cloudViewData(response)
  assert.equal(view.surface,null)
  assert.equal(estimationWarning(view),response.estimation_warning)
  assert.deepEqual(view.points,response.points)
})
test('ARKit coordinate rejection reaches the 3D warning', () => {
  const view=cloudViewData({points:[[1,2,3]],surface:null,geometry_warning:'Скачок карты'})
  assert.equal(view.geometry_warning,'Скачок карты')
})
test('old cached surfaces still pass through the client rejection policy',()=>{
  const view=cloudViewData({points:[[1,2,3]],surface:{volume:5.505,support:{volume_share:.29}}})
  assert.ok(estimationWarning(view))
})

test('photo reconstruction keeps its method and real mesh through the adapter', () => {
  const response = {points:[[0,0,0]], cameras:[], pile:[1],
    reconstruction:{method:'photogrammetry_arkit_scale',photo_count:87},
    surface:{volume:1.16254,mesh:{vertices:[[0,0,0]],faces:[]}}}
  const view=cloudViewData(response)
  assert.deepEqual(view.reconstruction,response.reconstruction)
  assert.deepEqual(view.surface.mesh,response.surface.mesh)
  assert.equal(estimationWarning(view),null)
})
