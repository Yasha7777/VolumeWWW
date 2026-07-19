import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, Bounds, Center } from '@react-three/drei'

// Настоящая 3D-модель (кубы) вместо частиц: реальный меш с текстурами,
// авто-вращение + лёгкий наклон от прокрутки. drei Bounds сам кадрирует модель
// (не нужно угадывать масштаб), Center — ставит её в центр, чтобы вращалась
// на месте. Прозрачный фон, клики не ловим.
const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const MODEL = '/models/cubes.glb'

function Cubes() {
  const { scene } = useGLTF(MODEL)
  const ref = useRef()
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    if (!REDUCE) g.rotation.y += dt * 0.28
    // мягкий наклон по мере прокрутки первого экрана
    const p = Math.min((typeof window !== 'undefined' ? window.scrollY : 0) / 600, 1)
    const targetX = p * 0.5 - 0.12
    g.rotation.x += (targetX - g.rotation.x) * Math.min(dt * 3, 1)
  })
  return (
    <group ref={ref}>
      <primitive object={scene} />
    </group>
  )
}

export default function CubesHeroImpl() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0.4, 6], fov: 42 }}
      style={{ pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 7, 5]} intensity={1.5} />
      <directionalLight position={[-5, 2, -4]} intensity={0.55} color="#c98a24" />
      <Suspense fallback={null}>
        <Bounds fit clip margin={1.2}>
          <Center>
            <Cubes />
          </Center>
        </Bounds>
      </Suspense>
    </Canvas>
  )
}

useGLTF.preload(MODEL)
