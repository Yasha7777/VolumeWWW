import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, Html, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · «сырьё → замер → стройка». Использует ТОЛЬКО детальные
   модели из /3dmodels (сжаты meshopt+KTX2, полигоны целы):
   • Акт 1 «Сырьё»: камень (stone_gravel) + гравий (pile_of_gravel) + песок-
     блок (block_sand_rock) со stagger влетают и медленно вращаются.
   • Акт 2 «Замер»: вокруг кластера прорисовывается габаритный бокс + размерная
     сетка с подписью м³/т (метафора фотограмметрии), камера наезжает.
   • Акт 3 «Стройка»: сырьё уходит, поднимается стройплощадка с башенным краном
     (construction_site…tower_crane), кран крутится, камера оседает.
   Свет: процедурный studio-Environment (Lightformer, офлайн — higgsfield=0
   кредитов) + ContactShadows. dpr=[1,2], тени вкл., AdaptiveDpr, dispose через
   useGLTF-кэш. prefers-reduced-motion → статичный кадр Акта 2.
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
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)   // smootherstep
const damp = THREE.MathUtils.damp

// нормализованная детальная модель: центр в 0, масштаб к target, тени вкл.
function Model({ url, target }) {
  const { scene } = useModel(url)
  const obj = useMemo(() => {
    const s = scene.clone(true)
    const box = new THREE.Box3().setFromObject(s)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const scl = target / (Math.max(size.x, size.y, size.z) || 1)
    s.scale.setScalar(scl)
    s.position.set(-center.x * scl, -box.min.y * scl, -center.z * scl) // низ на y=0
    s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })
    return s
  }, [scene, target])
  return <primitive object={obj} />
}

// габаритный бокс + размерная сетка (служебные примитивы — разрешено)
function MeasureBox({ w, h, d, appear }) {
  const grp = useRef()
  const box = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  useFrame(() => {
    if (!grp.current) return
    const s = smooth(appear.current)
    grp.current.scale.setScalar(0.001 + s)
    grp.current.traverse((o) => { if (o.material) o.material.opacity = s })
    grp.current.visible = s > 0.01
  })
  return (
    <group ref={grp} position={[0, h / 2, 0]}>
      <lineSegments>
        <edgesGeometry args={[box]} />
        <lineBasicMaterial color="#c98a24" transparent linewidth={2} />
      </lineSegments>
      {/* размерные тики по низу переднего ребра */}
      {Array.from({ length: 7 }).map((_, i) => {
        const x = -w / 2 + (w * i) / 6
        return (
          <lineSegments key={i} position={[x, -h / 2, d / 2]}>
            <edgesGeometry args={[new THREE.BoxGeometry(0.005, 0.16, 0.005)]} />
            <lineBasicMaterial color="#9A6410" transparent />
          </lineSegments>
        )
      })}
      <Html position={[0, h / 2 + 0.25, 0]} center distanceFactor={9} zIndexRange={[2, 0]}>
        <div className="kb-l3d-tag">V ≈ 1&nbsp;428&nbsp;м³ · 2&nbsp;271&nbsp;т</div>
      </Html>
    </group>
  )
}

function Scene() {
  const materials = useRef()
  const boxAppear = useRef(0)
  const site = useRef()
  const cam = useRef()
  const start = useRef(0)

  useFrame((state, dt) => {
    const cm = state.camera
    if (REDUCE) {
      // статичный кадр Акта 2
      if (materials.current) { materials.current.scale.setScalar(1); materials.current.visible = true }
      boxAppear.current = 1
      if (site.current) site.current.visible = false
      cm.position.set(4.6, 3.1, 7.2); cm.lookAt(0, 1.2, 0)
      return
    }
    if (!start.current) start.current = state.clock.elapsedTime
    const t = state.clock.elapsedTime - start.current

    // прогрессы актов
    const a1 = smooth(seg(t, 0.4, 4))          // сырьё влетает
    const a2 = smooth(seg(t, 4.2, 6.6))        // замер
    const outMat = smooth(seg(t, 7.4, 9.4))    // сырьё уходит
    const a3 = smooth(seg(t, 8.0, 11))         // стройка поднимается

    if (materials.current) {
      const g = materials.current
      g.visible = a1 > 0.001 && outMat < 0.999
      const sc = a1 * (1 - outMat)
      g.scale.setScalar(0.0001 + sc)
      g.position.y = (1 - a1) * -1.4 + outMat * 1.2
      g.rotation.y += dt * 0.25 * (1 - outMat)
    }
    boxAppear.current = a2 * (1 - outMat)

    if (site.current) {
      const s = site.current
      s.visible = a3 > 0.001
      const sc = a3
      s.scale.setScalar(0.0001 + sc)
      s.position.y = (1 - a3) * -3.2
      if (t > 10) s.rotation.y += dt * 0.08     // кран медленно поворачивается
    }

    // камера по актам + мягкий дрейф на удержании
    const hold = seg(t, 11, 13)
    let px, py, pz, lx = 0, ly = 1.2, lz = 0
    if (t < 6.6) { px = 7 - a2 * 2.4; py = 4 - a2 * 0.9; pz = 10 - a2 * 2.8 }
    else { px = 4.6 + a3 * 3.6; py = 3.1 + a3 * 2.2; pz = 7.2 + a3 * 5.2; ly = 1.2 + a3 * 1.6 }
    if (t > 11) { const dr = (t - 11) * 0.06; px += Math.sin(dr) * 1.2; pz += Math.cos(dr) * 0.6 }
    cm.position.x = damp(cm.position.x, px, 3, dt)
    cm.position.y = damp(cm.position.y, py, 3, dt)
    cm.position.z = damp(cm.position.z, pz, 3, dt)
    cm.lookAt(lx, ly, lz)
  })

  return (
    <>
      {/* studio-окружение процедурно (офлайн), мягкие блики на фотограмметрии */}
      <Environment resolution={256}>
        <Lightformer intensity={2.2} position={[0, 4, 2]} scale={[8, 4, 1]} color="#fff6e6" />
        <Lightformer intensity={1.1} position={[-4, 2, 1]} scale={[3, 4, 1]} color="#cfe0ff" />
        <Lightformer intensity={0.9} position={[4, 1, -2]} scale={[3, 3, 1]} color="#ffd9a0" />
      </Environment>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[5, 9, 5]} intensity={1.7} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002}
        shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}
      />
      <directionalLight position={[-6, 4, -4]} intensity={0.4} color="#c98a24" />

      {/* Акт 1–2: сырьё */}
      <group ref={materials}>
        <group position={[0, 0, 0]}><Model url={M.stone} target={2.2} /></group>
        <group position={[-2.3, 0, 0.4]}><Model url={M.gravel} target={1.7} /></group>
        <group position={[2.15, 0, -0.3]}><Model url={M.sand} target={1.55} /></group>
        <MeasureBox w={6.1} h={2.7} d={3.0} appear={boxAppear} />
      </group>

      {/* Акт 3: стройплощадка с краном */}
      <group ref={site} visible={false}><Model url={M.site} target={7.5} /></group>

      {/* мягкая контактная тень под сценой */}
      <ContactShadows position={[0, 0.01, 0]} scale={16} blur={2.6} far={6} opacity={0.42} resolution={512} />
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
      const fade = 1 - Math.min(Math.max((window.scrollY - vh * 0.5) / (vh * 0.6), 0), 1)
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
          frameloop={REDUCE ? 'demand' : frameloop}
          shadows
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [7, 4, 10], fov: 42 }}
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
