import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* ════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ · процедурное облако точек (WebGL). Focal-момент мира «прибор»:
   РЕКОНСТРУКЦИЯ. Точки рассыпаны (сырые пиксели снимков) и СОБИРАЮТСЯ в
   насыпь материала строго по позиции скролла героя — прокрутил вниз, облако
   реконструировалось в объект (метафора фотограмметрии). Часть точек —
   сигнальный survey-оранжевый (линии сканирования). Перф по CLAUDE.md:
   гейт frameloop по видимости, dirty-check по scroll-progress, dpr[1,1.5],
   отложенный маунт, заморозка при reduced-motion.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const COUNT = 6000
const smooth = (t) => t * t * (3 - 2 * t)

const ric = (fn) =>
  (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(fn, { timeout: 1200 })
    : setTimeout(fn, 200)
const cancelRic = (id) =>
  (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? window.cancelIdleCallback(id)
    : clearTimeout(id)

// прогресс сборки = позиция скролла (0 вверху героя → 1 через ~1 экран)
function scrollProgress() {
  if (REDUCE) return 1
  const vh = window.innerHeight || 1
  return Math.min(Math.max((window.scrollY || 0) / (vh * 0.95), 0), 1)
}

// предрасчёт: где точка рассыпана (scatter) и где она в насыпи (heap) + цвет.
// Насыпь — конус R×H, плотнее у основания, с шумом поверхности. Оранжевые
// точки (сигнал) распределены по «линиям сканирования» — кольцам по высоте.
function buildPoints(count) {
  const scatter = new Float32Array(count * 3)
  const heap = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)

  const graphite = new THREE.Color('#c3ccd2')
  const graphiteDim = new THREE.Color('#6f7a82')
  const orange = new THREE.Color('#ff6a2b')

  const R = 2.5, H = 2.7, yBase = -1.15
  for (let i = 0; i < count; i++) {
    const o = i * 3
    // heap: точка в объёме конуса (радиус ∝ √u для равномерности по площади)
    const ang = Math.random() * Math.PI * 2
    const rr = Math.sqrt(Math.random()) * R
    const maxY = H * (1 - rr / R)
    const y = Math.random() * maxY
    // лёгкий шум поверхности
    const nz = (Math.random() - 0.5) * 0.14
    heap[o]     = Math.cos(ang) * rr + nz
    heap[o + 1] = yBase + y
    heap[o + 2] = Math.sin(ang) * rr + nz

    // scatter: «сырые» точки скана — плотная центрированная туманность (не редкая
    // пыль по всему кадру), чтобы hero читался как облако-скан ещё до скролла
    scatter[o]     = (Math.random() - 0.5) * 7.5
    scatter[o + 1] = (Math.random() - 0.5) * 4.6 + 0.4
    scatter[o + 2] = (Math.random() - 0.5) * 5 - 1

    // цвет: в основном графит (ярче у вершины), ~9% — оранжевые «линии скана»
    const band = Math.floor((y / H) * 7)          // кольца по высоте
    const isScan = band % 2 === 0 && Math.random() < 0.16
    if (isScan) {
      color[o] = orange.r; color[o + 1] = orange.g; color[o + 2] = orange.b
    } else {
      const t = Math.min((y / H) * 1.2, 1)
      const c = graphiteDim.clone().lerp(graphite, t)
      // случайная тусклость → глубина облака
      const dim = 0.55 + Math.random() * 0.45
      color[o] = c.r * dim; color[o + 1] = c.g * dim; color[o + 2] = c.b * dim
    }
  }
  return { scatter, heap, color }
}

function Cloud() {
  const ref = useRef()
  const lastE = useRef(-1)
  const { scatter, heap, color } = useMemo(() => buildPoints(COUNT), [])

  // стартовая геометрия = scatter (контент виден даже если useFrame не успел)
  const positions = useMemo(() => scatter.slice(), [scatter])

  useFrame((_, dt) => {
    const pts = ref.current
    if (!pts) return
    const e = smooth(scrollProgress())
    // DIRTY-CHECK: позиции зависят только от e — не сдвинулся скролл, не трогаем буфер
    if (Math.abs(e - lastE.current) > 1e-4) {
      lastE.current = e
      const arr = pts.geometry.attributes.position.array
      for (let i = 0; i < arr.length; i++) {
        arr[i] = scatter[i] + (heap[i] - scatter[i]) * e
      }
      pts.geometry.attributes.position.needsUpdate = true
    }
    // медленный доворот собранной насыпи (дёшево, буфер не трогает)
    if (!REDUCE) ref.current.rotation.y += dt * 0.06 * e
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={COUNT} array={color} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.032}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.92}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export default function PointCloudLandingImpl() {
  const wrapRef = useRef(null)
  const visibleRef = useRef(true)
  const [frameloop, setFrameloop] = useState('always')

  // канвас живёт В герое; гаснет и замирает, когда герой ушёл за скролл
  useEffect(() => {
    if (REDUCE) return
    const onScroll = () => {
      const vh = window.innerHeight || 1
      const fade = 1 - Math.min(Math.max((window.scrollY - vh * 1.0) / (vh * 0.7), 0), 1)
      if (wrapRef.current) wrapRef.current.style.opacity = String(fade)
      const vis = fade > 0.01
      if (vis !== visibleRef.current) {
        visibleRef.current = vis
        setFrameloop(vis ? 'always' : 'never')
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // reduced-motion: даём собраться и замираем
  useEffect(() => {
    if (!REDUCE) return
    const t = setTimeout(() => setFrameloop('never'), 1200)
    return () => clearTimeout(t)
  }, [])

  // отложенный маунт — не блокируем первый paint hero-текста
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    let id
    const raf = requestAnimationFrame(() => { id = ric(() => setMounted(true)) })
    return () => { cancelAnimationFrame(raf); if (id != null) cancelRic(id) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-cloud">
      {mounted && (
        <Canvas
          frameloop={frameloop}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 1.15, 6], fov: 46 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.35, 0)}
          style={{ pointerEvents: 'none' }}
        >
          <Cloud />
        </Canvas>
      )}
    </div>
  )
}
