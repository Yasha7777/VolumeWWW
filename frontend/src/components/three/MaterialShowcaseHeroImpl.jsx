import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · дрон садится к земле у стройплощадки; МНОГО ИНСТАНСОВ
   гравия/песка/камня (геометрии из /3dmodels, meshopt+KTX2, полигоны целы)
   слетаются в одну точку и УКЛАДЫВАЮТСЯ В ПЛОТНЫЙ КОНУС-НАСЫПЬ, затем
   замирают. Рядом маленький калибровочный куб (~×5 меньше кучи). Здание с
   краном — окружение на земле. Камера финиширует низко и близко (ракурс
   снизу вверх), без клиппинга сквозь пол/модели. reduced-motion → статичный
   собранный кадр. Инстансинг (одна геометрия × N), тени только у здания/куба,
   dpr[1,2]. Всё на земле.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const MOBILE = typeof window !== 'undefined' && window.innerWidth < 700

const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = THREE.MathUtils.lerp
const rand = (a, b) => a + Math.random() * (b - a)

// куча-конус: R база, H высота
const CONE = { R: 1.9, H: 2.4 }

// достаём геометрию+материал модели, запекаем мировую матрицу, нормируем max-dim→1
function useInstGeo(url) {
  const { scene } = useModel(url)
  return useMemo(() => {
    let picked = null
    scene.updateWorldMatrix(true, true)
    scene.traverse((o) => {
      if (o.isMesh && o.geometry && !picked) {
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld)
        picked = { geo: g, mat: Array.isArray(o.material) ? o.material[0] : o.material }
      }
    })
    if (!picked) return null
    picked.geo.computeBoundingBox()
    const size = new THREE.Vector3(); picked.geo.boundingBox.getSize(size)
    const c = new THREE.Vector3(); picked.geo.boundingBox.getCenter(c)
    const s = 1 / (Math.max(size.x, size.y, size.z) || 1)
    picked.geo.translate(-c.x, -c.y, -c.z); picked.geo.scale(s, s, s)
    return picked
  }, [scene])
}

// упаковка «шкуры» конуса (плотная поверхность) + разлёт СВЕРХУ (сыплется на место)
function packCone(count, sMin, sMax, span) {
  const arr = []
  for (let i = 0; i < count; i++) {
    const y = Math.random() * CONE.H
    const maxR = CONE.R * (1 - y / CONE.H)
    const ang = Math.random() * Math.PI * 2
    const r = maxR * rand(0.7, 1.0)                 // ближе к поверхности → плотная шкура, без сквозных дыр
    const sc = sMin + Math.random() * (sMax - sMin)
    const heap = [Math.cos(ang) * r, y, Math.sin(ang) * r]
    // сыплется СВЕРХУ на своё место (не рой по экрану) → аккуратная укладка
    const scatter = [heap[0] + rand(-1.4, 1.4), rand(3.2, 6.5), heap[2] + rand(-1.4, 1.4)]
    arr.push({
      heap, scatter, sc,
      rel: (i / count) * span + rand(0, 0.5),
      rot: [rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI)],
      ph: rand(0, Math.PI * 2),
    })
  }
  return arr
}

function InstPile({ geo, mat, data, tRef }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const eul = useMemo(() => new THREE.Euler(), [])
  useFrame(() => {
    const mesh = ref.current; if (!mesh) return
    const t = tRef.current
    for (let i = 0; i < data.length; i++) {
      const d = data[i]
      const s = REDUCE ? 1 : smooth(seg(t, d.rel, d.rel + 1.6))
      const drift = REDUCE ? 0 : Math.sin(t * 0.8 + d.ph) * 0.006 * s
      dummy.position.set(
        lerp(d.scatter[0], d.heap[0], s),
        lerp(d.scatter[1], d.heap[1], s) + drift,
        lerp(d.scatter[2], d.heap[2], s),
      )
      eul.set(d.rot[0], d.rot[1], d.rot[2]); dummy.quaternion.setFromEuler(eul)
      dummy.scale.setScalar(Math.max(0.0001, d.sc * s))
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  // тени частиц выключены (их сотни) — контакт даёт ContactShadows
  return <instancedMesh ref={ref} args={[geo, mat, data.length]} frustumCulled={false} receiveShadow />
}

// один блок модели → InstancedMesh с упаковкой в конус
function MaterialInstances({ url, count, sMin, sMax, span, tRef }) {
  const g = useInstGeo(url)
  const data = useMemo(() => packCone(count, sMin, sMax, span), [count, sMin, sMax, span])
  if (!g) return null
  return <InstPile geo={g.geo} mat={g.mat} data={data} tRef={tRef} />
}

// нормализованное здание-окружение
function Building({ url, target }) {
  const { scene } = useModel(url)
  return useMemo(() => {
    const s = scene.clone(true)
    const box = new THREE.Box3().setFromObject(s); const size = new THREE.Vector3(); box.getSize(size)
    const c = new THREE.Vector3(); box.getCenter(c)
    const scl = target / (Math.max(size.x, size.y, size.z) || 1)
    s.scale.setScalar(scl); s.position.set(-c.x * scl, -box.min.y * scl, -c.z * scl)
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
  const SIZE = 0.48                                   // ~в 5 раз ниже кучи (H 2.4)
  useFrame((_, dt) => {
    if (!ref.current) return
    const s = REDUCE ? 1 : smooth(seg(tRef.current, 2.6, 4.0))
    ref.current.visible = s > 0.02
    ref.current.position.set(2.15, SIZE / 2 + (1 - s) * 3.0, 0.9)   // вплотную к куче, на земле
    ref.current.scale.setScalar(SIZE * (0.4 + 0.6 * s))
    if (!REDUCE && s > 0.98) ref.current.rotation.y += dt * 0.15
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
  const tRef = useRef(0)

  useFrame((state, dt) => {
    const cm = state.camera
    tRef.current += REDUCE ? 0 : Math.min(dt, 0.05)
    const t = REDUCE ? 99 : tRef.current

    // ── КАМЕРА-ДРОН: аэрофото → снижение и наезд НА КУЧУ (кран за ней) ──
    const p = smooth(Math.min(t / 5.0, 1))
    const sway = REDUCE ? 0 : lerp(0.5, 0.1, p)
    cm.position.set(
      lerp(7, 3.0, p) + Math.sin(t * 0.55) * sway * 0.4,
      Math.max(0.9, lerp(16, 1.6, p) + Math.sin(t * 0.9) * sway),     // не ниже 0.9 → без клипа пола
      lerp(13, 5.4, p) + Math.cos(t * 0.7) * sway * 0.4,
    )
    cm.lookAt(0, lerp(3.0, 1.4, p), lerp(-3.5, -1.5, p))              // куча в центре, здание+кран сзади

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

      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#4a4034" roughness={1} />
      </mesh>

      {/* ЗДАНИЕ с краном — ОКРУЖЕНИЕ СЗАДИ (отодвинуто, чтобы не загораживать кучу) */}
      <group ref={buildingRef} position={[0, 0, -9.5]} rotation={[0, -0.35, 0]}>
        <Suspense fallback={null}><Building url="/models/site_crane.glb" target={13} /></Suspense>
      </group>

      {/* ПЛОТНАЯ КУЧА из МНОГИХ МЕЛКИХ ИНСТАНСОВ (сыплются сверху → укладываются) */}
      <group position={[0, 0, 0.2]}>
        <Suspense fallback={null}>
          <MaterialInstances url="/models/block_sand_rock.glb" count={MOBILE ? 3000 : 8000} sMin={0.020} sMax={0.036} span={2.8} tRef={tRef} />
          <MaterialInstances url="/models/pile_of_gravel.glb" count={MOBILE ? 500 : 1200} sMin={0.03} sMax={0.06} span={3.0} tRef={tRef} />
          <MaterialInstances url="/models/stone_gravel.glb" count={MOBILE ? 3 : 5} sMin={0.03} sMax={0.05} span={3.2} tRef={tRef} />
        </Suspense>
      </group>

      <CalibCube tRef={tRef} />

      <ContactShadows position={[0, 0.01, 0.4]} scale={16} blur={2.4} far={7} opacity={0.55} resolution={1024} />
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
          camera={{ position: [6, 16, 12], fov: 40, near: 0.25, far: 200 }}>
          <Suspense fallback={null}><Scene /></Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
