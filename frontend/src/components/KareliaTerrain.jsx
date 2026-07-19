import { lazy, Suspense } from 'react'

const Impl = lazy(() => import('./three/KareliaTerrainImpl'))

export default function KareliaTerrain() {
  return (
    <Suspense fallback={null}>
      <Impl />
    </Suspense>
  )
}
