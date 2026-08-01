import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · КИНЕМАТОГРАФИЧНЫЙ ДРОН-ЗАХОД НА СТРОЙПЛОЩАДКУ.
   Никаких роёв инстансов. Только детальные модели /3dmodels (meshopt+KTX2,
   полигоны целы): здание с башенным краном (site_crane) — окружение в
   реальном масштабе на «земле»; материал (гравий+песок+камень) СЛЕТАЕТСЯ В
   ОДНУ КУЧУ и укладывается, затем замирает; рядом вплотную — калибровочный
   куб. Камера «прилетает» дроном (аэрофото → снижение и наезд → покачивание →
   посадка ракурса), потом висит с мягким дрейфом. Свет: studio-Environment +
   ContactShadows. dpr[1,2], тени вкл., reduced-motion → статичный собранный
   кадр площадки с кучей. Всё стоит на земле — ничего не висит.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)   // smootherstep
const lerp = THREE.MathUtils.lerp

// нормализованная детальная модель: центр по XZ, низ на y=0, масштаб к target
function Model({ url, target }) {
  const { scene } = useModel(url)
  return useMemo(() => {
    const s = scene.clone(true)
    const box = new THREE.Box3().setFromObject(s)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const scl = target / (Math.max(size.x, size.y, size.z) || 1)
    s.scale.setScalar(scl)
    s.position.set(-center.x * scl, -box.min.y * scl, -center.z * scl)
    s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })
    return <primitive object={s} />
  }, [scene, target])
}

function CalibCube({ tRef }) {
  const map = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512
    const ctx = cv.getContext('2d'); const s = 128
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { ctx.fillStyle = (x + y) % 2 ? '#161616' : '#f2ede1'; ctx.fillRect(x * s, y * s, s, s) }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t
  }, [])
  const ref = useRef()
  const SIZE = 0.9
  useFrame((_, dt) => {
    if (!ref.current) return
    const s = REDUCE ? 1 : smooth(seg(tRef.current, 2.4, 3.9))
    ref.current.visible = s > 0.02
    ref.current.position.set(2.35, SIZE / 2 + (1 - s) * 3.4, 1.6)   // падает на землю вплотную к куче
    ref.current.scale.setScalar(SIZE * (0.35 + 0.65 * s))
    if (!REDUCE && s > 0.98) ref.current.rotation.y += dt * 0.18
  })
  return (
    <mesh ref={ref} castShadow receiveShadow visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial map={map} roughness={0.55} metalness={0.05} />
    </mesh>
  )
}

function Scene() {
  const buildingRef = useRef()
  const cubeT = useRef(0)
  const acc = useRef(0)
  const pileRef = useRef(); const sandRef = useRef(); const stoneRef = useRef()

  // материал: куда лечь (heap) и откуда прилететь (from) + окно сборки
  const MATS = useMemo(() => ([
    { ref: pileRef, url: '/models/pile_of_gravel.glb', target: 3.0, heap: [0, 0, 0.4], from: [-3.2, 5.5, 3.6], a: 0.4, b: 2.6 },
    { ref: sandRef, url: '/models/block_sand_rock.glb', target: 1.6, heap: [1.45, 0, 1.05], from: [4.6, 4.5, 2.4], a: 1.0, b: 3.2 },
    { ref: stoneRef, url: '/models/stone_gravel.glb', target: 1.5, heap: [-0.45, 0.9, 0.05], from: [-4.2, 6, -2.6], a: 1.7, b: 3.7 },
  ]), [])

  useFrame((state, dt) => {
    const cm = state.camera
    acc.current += Math.min(dt, 0.05)
    const t = REDUCE ? 99 : acc.current
    cubeT.current = t

    // ── КАМЕРА-ДРОН: аэрофото → снижение и наезд → посадка + мягкий дрейф ──
    const p = smooth(Math.min(t / 4.8, 1))
    const sway = REDUCE ? 0 : lerp(0.55, 0.13, p)     // покачивание: сильнее в полёте, тише на зависании
    const px = lerp(6.5, 5.0, p) + Math.sin(t * 0.55) * sway * 0.6
    const py = lerp(17, 4.4, p) + Math.sin(t * 0.9) * sway
    const pz = lerp(12.5, 9.5, p) + Math.cos(t * 0.7) * sway * 0.6
    cm.position.set(px, py, pz)
    cm.lookAt(0, lerp(2.2, 1.05, p), 0.3)

    // ── МАТЕРИАЛ СЛЕТАЕТСЯ В ОДНУ КУЧУ и укладывается ──
    for (const m of MATS) {
      const g = m.ref.current; if (!g) continue
      const s = REDUCE ? 1 : smooth(seg(t, m.a, m.b))
      g.visible = s > 0.01
      g.position.set(lerp(m.from[0], m.heap[0], s), lerp(m.from[1], m.heap[1], s), lerp(m.from[2], m.heap[2], s))
      g.scale.setScalar(0.0001 + s)
    }

    if (buildingRef.current && !REDUCE) buildingRef.current.rotation.y = -0.4 + Math.min(t, 25) * 0.003
  })

  return (
    <>
      <Environment resolution={256}>
        <Lightformer intensity={2.4} position={[0, 7, 4]} scale={[14, 7, 1]} color="#fff2da" />
        <Lightformer intensity={1.0} position={[-7, 3, 1]} scale={[5, 7, 1]} color="#cfe0ff" />
        <Lightformer intensity={0.9} position={[7, 2, -3]} scale={[5, 5, 1]} color="#ffcf8f" />
      </Environment>
      <ambientLight intensity={0.4} />
      <directionalLight position={[7, 14, 7]} intensity={1.9} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
      <directionalLight position={[-8, 5, -4]} intensity={0.4} color="#c98a24" />

      {/* земля-грунт */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#4a4034" roughness={1} />
      </mesh>

      {/* ЗДАНИЕ с башенным краном — окружение на земле, в реальном масштабе */}
      <group ref={buildingRef} position={[0.4, 0, -3.2]} rotation={[0, -0.4, 0]}>
        <Suspense fallback={null}><Model url="/models/site_crane.glb" target={12} /></Suspense>
      </group>

      {/* МАТЕРИАЛ → одна куча */}
      {MATS.map((m, i) => (
        <group key={i} ref={m.ref} visible={false}>
          <Suspense fallback={null}><Model url={m.url} target={m.target} /></Suspense>
        </group>
      ))}

      {/* калибровочный куб вплотную к куче */}
      <CalibCube tRef={cubeT} />

      <ContactShadows position={[0, 0.01, 0.6]} scale={20} blur={2.4} far={8} opacity={0.5} resolution={1024} />
    </>
  )
}

function Loader() {
  const { active, progress } = useProgress()
  if (!active) return null
  return <div className="kb-l3d-loader"><div className="kb-l3d-loader__bar"><i style={{ width: `${progress}%` }} /></div><span>{Math.round(progress)}%</span></div>
}

export default function MaterialShowcaseHeroImpl() {
  const wrapRef = useRef(null)
  const visibleRef = useRef(true)
  const [frameloop, setFrameloop] = useState('always')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const vh = window.innerHeight || 1
      const fade = 1 - Math.min(Math.max((window.scrollY - vh * 0.95) / (vh * 0.5), 0), 1)
      if (wrapRef.current) wrapRef.current.style.opacity = String(fade)
      const vis = fade > 0.02 && !document.hidden
      if (vis !== visibleRef.current) { visibleRef.current = vis; setFrameloop(vis ? 'always' : 'never') }
    }
    const onVis = () => { if (document.hidden) setFrameloop('never'); else onScroll() }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('scroll', onScroll); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  useEffect(() => { const raf = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(raf) }, [])

  return (
    <div ref={wrapRef} className="kb-l-flow">
      <Loader />
      {mounted && (
        <Canvas frameloop={REDUCE ? 'demand' : frameloop} shadows dpr={[1, 2]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [6.5, 17, 12.5], fov: 38 }}>
          <Suspense fallback={null}><Scene /></Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
