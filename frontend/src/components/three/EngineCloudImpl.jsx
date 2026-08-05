import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { useProgress, AdaptiveDpr } from '@react-three/drei'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader'
import * as THREE from 'three'
import { levelGeometry } from '../plyAlign'

/* ════════════════════════════════════════════════════════════════════════
   СЦЕНА СЕКЦИИ «ДВИЖОК» · РЕАЛЬНЫЕ ОБЛАКА DUSt3R
   Показываем ровно то, что отдаёт сервис — фотореалистичное облако точек
   реконструкции, медленно вращающееся за стеклом. Это буквальная
   демонстрация «того же движка, что в сервисе».

   МАКС.ОПТИМ (легче прежней сцены с краном-GLB ~12МБ + 4000 PBR-инстансов):
   • грузим ТОЛЬКО активное облако (Suspense key=url). Остальные два
     скачиваются лишь когда пользователь выбрал их в switcher (см. Engine).
     На входе — один запрос ~4.5МБ, а не все три (~13.7МБ);
   • frameloop гейтится ВИДИМОСТЬЮ секции (never↔always) — за скроллом GPU
     спит, авто-вращение замирает без ручных invalidate;
   • канвас монтируется отложенно (rAF), не блокируя первый paint формы/копи;
   • points = ОДИН draw call, без теней / PBR / Environment;
   • ориентация «вверх» — тем же plyAlign (RANSAC-плоскость + масс-проверка),
     что и вьюер сервиса, чтобы насыпь не вставала вверх дном.
   ════════════════════════════════════════════════════════════════════════ */

// Те же реконструкции, что живут в сервисе (Supabase bucket dust3r-ply).
export const RECONSTRUCTIONS = [
  'https://supabase.gottland.ru/storage/v1/object/public/dust3r-ply/c7a20aff-a32b-4023-b0b7-3500e6094c39/dust3r_output.ply',
  'https://supabase.gottland.ru/storage/v1/object/public/dust3r-ply/42833ee2-e841-429b-b466-96dea9e866fd/dust3r_output.ply',
  'https://supabase.gottland.ru/storage/v1/object/public/dust3r-ply/19495962-52c5-4294-b058-d298f9aa92a6/dust3r_output.ply',
]

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const MOBILE = typeof window !== 'undefined' && window.innerWidth < 700
const BG = '#F4F0E8'            // кремовый фон лендинга — в него уходит туман
const TARGET_R = 3.0           // нормируем радиус облака → камера фиксирована

// Одно облако: выравниваем «вверх», центрируем, нормируем масштаб, плавно
// проявляем. Материал точек с реальными vertex-цветами DUSt3R.
function Cloud({ url, onReady }) {
  const geometry = useLoader(PLYLoader, url)
  const matRef = useRef()
  const t0 = useRef(0)

  useMemo(() => {
    // levelGeometry идемпотентна (userData.__leveled) — безопасно в StrictMode.
    levelGeometry(geometry)
    geometry.computeBoundingSphere()
    const { center, radius } = geometry.boundingSphere
    geometry.translate(-center.x, -center.y, -center.z)
    const s = TARGET_R / (radius || 1)
    geometry.scale(s, s, s)
    geometry.computeBoundingSphere()
    return true
  }, [geometry])

  useEffect(() => { onReady?.() }, [onReady])

  const hasColors = geometry.attributes.color != null

  // Плавный fade-in при появлении/переключении (только при живом frameloop).
  useFrame((state) => {
    const m = matRef.current
    if (!m || REDUCE) return
    if (!t0.current) t0.current = state.clock.elapsedTime
    const k = Math.min(1, (state.clock.elapsedTime - t0.current) / 0.6)
    m.opacity = 0.92 * (k * k * (3 - 2 * k))
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={matRef}
        size={MOBILE ? 0.016 : 0.012}
        vertexColors={hasColors}
        color={hasColors ? undefined : '#2f4a1c'}
        sizeAttenuation
        transparent
        opacity={REDUCE ? 0.92 : 0}
      />
    </points>
  )
}

// Вращающийся риг + облако. useFrame тикает только при frameloop "always".
function Scene({ url, onLoaded }) {
  const groupRef = useRef()
  useFrame((_, dt) => {
    if (groupRef.current && !REDUCE) groupRef.current.rotation.y += dt * 0.12
  })
  return (
    <group ref={groupRef} rotation={[0.16, 0.5, 0]}>
      <Suspense fallback={null}>
        <Cloud url={url} onReady={onLoaded} />
      </Suspense>
    </group>
  )
}

function Loader() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="kb-l3d-loader">
      <div className="kb-l3d-loader__bar"><i style={{ width: `${progress}%` }} /></div>
      <span>{Math.round(progress)}%</span>
    </div>
  )
}

export default function EngineCloudImpl({ index = 0 }) {
  const url = RECONSTRUCTIONS[index] || RECONSTRUCTIONS[0]
  const wrapRef = useRef(null)
  const visibleRef = useRef(false)
  const [frameloop, setFrameloop] = useState('never')   // включим, когда секция в кадре
  const [mounted, setMounted] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState(null)

  // отложенный маунт канваса — не блокируем первый paint копи/формы
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Гейт рендера ПО ВИДИМОСТИ СЕКЦИИ (сцена живёт посреди страницы).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || REDUCE) return
    const io = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting
      setFrameloop(e.isIntersecting && !document.hidden ? 'always' : 'never')
    }, { threshold: 0 })
    io.observe(el)
    const onVis = () => setFrameloop(!document.hidden && visibleRef.current ? 'always' : 'never')
    document.addEventListener('visibilitychange', onVis)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-flow">
      {loadedUrl !== url && <Loader />}
      {mounted && (
        <Canvas
          frameloop={REDUCE ? 'demand' : frameloop}
          dpr={MOBILE ? [1, 1] : [1, 1.5]}
          gl={{ alpha: true, antialias: !MOBILE, powerPreference: 'high-performance' }}
          camera={{ position: [2.6, 2.2, 8.6], fov: 42, near: 0.1, far: 200 }}>
          <fog attach="fog" args={[BG, 7, 17]} />
          <Suspense fallback={null}>
            {/* key=url: смена реконструкции размонтирует старое облако и
                грузит новое (кэш useLoader → назад без повторной загрузки) */}
            <Scene key={url} url={url} onLoaded={() => setLoadedUrl(url)} />
          </Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
