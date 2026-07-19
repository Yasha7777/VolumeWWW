import { lazy, Suspense } from 'react'

// r3f + drei + GLB тяжёлые — грузим лениво, чтобы не блокировать первый экран.
const Impl = lazy(() => import('./three/CubesHeroImpl'))

export default function CubesHero() {
  return (
    <Suspense fallback={null}>
      <Impl />
    </Suspense>
  )
}
