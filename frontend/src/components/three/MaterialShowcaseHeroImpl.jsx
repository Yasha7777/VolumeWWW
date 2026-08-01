import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, Html, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · SCROLL-DRIVEN. Из детальных моделей /3dmodels (meshopt+KTX2,
   полигоны целы): по мере прокрутки ЗДАНИЕ со стройплощадки/краном (site_crane)
   ПРИБЛИЖАЕТСЯ, а на его земле СОБИРАЕТСЯ КУЧА из гравия (pile_of_gravel) +
   песка (block_sand_rock) + камня (stone_gravel); рядом с кучей встаёт
   ШАХМАТНЫЙ калибровочный куб (процедурный — служебный референс масштаба).
   Наверху прорисовывается габаритный бокс + подпись м³/т (замер).
   Всё привязано к scrollY (scroll-scrub), как на hero основного сайта.
   Свет: процедурный studio-Environment + ContactShadows, тени вкл., dpr[1,2],
   reduced-motion → статичный собранный кадр.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const M = {
  stone: '/models/stone_gravel.glb',
  gravel: '/models/pile_of_gravel.glb',
  sand: '/models/block_sand_rock.glb',
  site: '/models/site_crane.glb',
}

const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = THREE.MathUtils.lerp

// прогресс = позиция скролла (0 вверху героя → 1 через ~1.1 экрана)
function scrollP() {
  if (REDUCE) return 1
  const vh = window.innerHeight || 1
  return Math.min(Math.max((window.scrollY || 0) / (vh * 1.1), 0), 1)
}

// процедурная шахматка 4×4 (калибровочный куб)
function checkerTexture(cells = 4, px = 512) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const ctx = cv.getContext('2d')
  const s = px / cells
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#161616' : '#f2ede1'
      ctx.fillRect(x * s, y * s, s, s)
    }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

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

function MeasureBox({ w, h, d, appearRef }) {
  const grp = useRef()
  const box = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const ticks = useMemo(() => new THREE.BoxGeometry(0.02, 0.18, 0.02), [])
  useFrame(() => {
    if (!grp.current) return
    const s = smooth(appearRef.current)
    grp.current.scale.set(1, s, 1)
    grp.current.visible = s > 0.02
    grp.current.traverse((o) => { if (o.material) o.material.opacity = s })
  })
  return (
    <group ref={grp} position={[0, 0, 0]}>
      <lineSegments position={[0, h / 2, 0]}>
        <edgesGeometry args={[box]} />
        <lineBasicMaterial color="#c98a24" transparent />
      </lineSegments>
      {Array.from({ length: 7 }).map((_, i) => (
        <lineSegments key={i} position={[-w / 2 + (w * i) / 6, 0.09, d / 2]}>
          <edgesGeometry args={[ticks]} />
          <lineBasicMaterial color="#9A6410" transparent />
        </lineSegments>
      ))}
      <Html position={[0, h + 0.3, 0]} center distanceFactor={11} zIndexRange={[3, 0]}>
        <div className="kb-l3d-tag">V ≈ 1&nbsp;428&nbsp;м³ · 2&nbsp;271&nbsp;т</div>
      </Html>
    </group>
  )
}

// шахматный калибровочный куб рядом с кучей
function CalibCube({ dropRef }) {
  const ref = useRef()
  const map = useMemo(() => checkerTexture(4), [])
  useFrame((_, dt) => {
    if (!ref.current) return
    const p = dropRef.current
    const s = smooth(seg(p, 0, 1))
    const size = 1.15
    ref.current.visible = s > 0.02
    // падает сверху на землю рядом с кучей + лёгкий доворот
    ref.current.position.set(2.9, size / 2 + (1 - s) * 4.2, 2.7)
    ref.current.scale.setScalar(size * (0.4 + 0.6 * s))
    if (!REDUCE && s > 0.98) ref.current.rotation.y += dt * 0.25
    else ref.current.rotation.set(0, s * 0.4, 0)
  })
  return (
    <mesh ref={ref} castShadow receiveShadow visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial map={map} roughness={0.55} metalness={0.05} />
    </mesh>
  )
}

function Scene() {
  const gravel = useRef(); const sand = useRef(); const stone = useRef()
  const building = useRef()
  const boxAppear = useRef(0)
  const cubeDrop = useRef(0)

  // задаём scale+pos кучи по scroll-прогрессу (сборка снизу вверх).
  // размер задаёт target модели → group растёт 0→1 (без двойного масштаба)
  const grow = (ref, p, a, b, pos) => {
    if (!ref.current) return
    const s = smooth(seg(p, a, b))
    ref.current.visible = s > 0.02
    ref.current.position.set(pos[0], pos[1] + (1 - s) * -1.2, pos[2])
    ref.current.scale.setScalar(0.0001 + s)
  }

  useFrame((state, dt) => {
    const p = scrollP()
    const cm = state.camera

    // здание ПРИБЛИЖАЕТСЯ: камера наезжает по мере прокрутки
    const e = smooth(p)
    cm.position.x = lerp(0.5, 3.6, e)
    cm.position.y = lerp(8.5, 3.3, e)
    cm.position.z = lerp(24, 12.5, e)
    cm.lookAt(0, lerp(3.4, 1.5, e), 1.8)

    // куча из гравия + песка + камня собирается на земле (stagger)
    grow(gravel, p, 0.08, 0.5, [-0.7, 0, 2.2])
    grow(sand, p, 0.18, 0.6, [1.0, 0, 2.7])
    grow(stone, p, 0.28, 0.68, [0.25, 0.55, 1.8])

    cubeDrop.current = seg(p, 0.42, 0.72)
    boxAppear.current = seg(p, 0.76, 0.96)

    if (building.current && !REDUCE) building.current.rotation.y = -0.35 + p * 0.25
  })

  return (
    <>
      <Environment resolution={256}>
        <Lightformer intensity={2.2} position={[0, 5, 3]} scale={[10, 5, 1]} color="#fff4e0" />
        <Lightformer intensity={1.1} position={[-5, 3, 1]} scale={[4, 5, 1]} color="#cfe0ff" />
        <Lightformer intensity={0.9} position={[5, 2, -2]} scale={[4, 4, 1]} color="#ffd39a" />
      </Environment>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[6, 12, 6]} intensity={1.7} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14}
      />
      <directionalLight position={[-7, 5, -4]} intensity={0.4} color="#c98a24" />

      {/* ЗДАНИЕ со стройплощадки/краном — сзади, приближается камерой */}
      <group ref={building} position={[0, 0, -3.5]} rotation={[0, -0.35, 0]}>
        <Model url={M.site} target={13} />
      </group>

      {/* КУЧА из песка + гравия + камня на земле здания */}
      <group ref={gravel} visible={false}><Model url={M.gravel} target={2.7} /></group>
      <group ref={sand} visible={false}><Model url={M.sand} target={1.9} /></group>
      <group ref={stone} visible={false}><Model url={M.stone} target={1.7} /></group>

      {/* ШАХМАТНЫЙ калибровочный куб рядом с кучей */}
      <CalibCube dropRef={cubeDrop} />

      {/* габаритный бокс + подпись м³/т вокруг кучи */}
      <group position={[0.15, 0, 2.2]}>
        <MeasureBox w={4.6} h={2.7} d={3.1} appearRef={boxAppear} />
      </group>

      <ContactShadows position={[0, 0.01, 1.6]} scale={20} blur={2.6} far={7} opacity={0.45} resolution={1024} />
    </>
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

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-flow">
      <Loader />
      {mounted && (
        <Canvas
          frameloop={frameloop}
          shadows
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [0.5, 8.5, 24], fov: 40 }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
