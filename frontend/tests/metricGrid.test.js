import test from 'node:test'
import assert from 'node:assert/strict'
import {fitTrack, metricGrid, metricStep} from '../src/components/obhod/mapGeometry.js'
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`)
for (const width of [320,539,900]) {
 test(`grid shares the physical scale and origin at width ${width}`,()=>{
  const fit=fitTrack([[-7,-9],[4,-1],[9,6]],width,488)
  const grid=metricGrid(fit,width,488)
  close(grid.stepPx,grid.stepM*fit.pxPerM)
  const [x,y]=fit.map([0,0])
  for(const line of grid.xs) close((line-x)/grid.stepPx,Math.round((line-x)/grid.stepPx))
  for(const line of grid.ys) close((line-y)/grid.stepPx,Math.round((line-y)/grid.stepPx))
  close(fit.bar.len/fit.bar.label,grid.stepPx/grid.stepM)
 })
}
test('3D normalization preserves metre spacing for small and large scans',()=>{
 for(const radius of [.4,2.444,5.329,20,80]) {
  const step=metricStep(.3*radius),half=Math.ceil(1.55*radius/step)
  const normalizedSize=2*half*step/radius,divisions=2*half
  close(normalizedSize/divisions*radius,step)
 }
})
