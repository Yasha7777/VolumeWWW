import { lazy, Suspense } from 'react'

// three.js тяжёлый — грузим сцену лениво, чтобы не блокировать первый экран.
const Impl = lazy(() => import('./three/PointCloudHeroImpl'))

export default function PointCloudHero() {
  return (
    <Suspense fallback={null}>
      <Impl />
    </Suspense>
  )
}
