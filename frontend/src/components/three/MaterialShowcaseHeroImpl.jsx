import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · ВИХРЬ СБОРКИ НАСЫПИ (top-down изометрия, самоиграющий).
   Тысячи летящих кусочков гравия+песка (instanced, текстуры реального гравия/
   песка) закручиваются ВИХРЕМ и коилятся в РАСТУЩУЮ НАСЫПЬ (height-field, угол
   откоса). Рядом — процедурный шахматный калибровочный куб. Сзади — детальная
   стройплощадка с краном (site_crane из /3dmodels, meshopt+KTX2). Поверх — AR-
   маркеры (Объём/Масса/Точность/НОВОЕ, drei Html). Пыль в свете. Перф: 2 draw
   call на материал, CPU-физика по типизированным массивам, frameloop-гейт,
   dpr[1,2], reduced-motion → статичная собранная насыпь.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const MOBILE = typeof window !== 'undefined' && window.innerWidth < 700

const FALL = 0, REST = 1
const rand = (a, b) => a + Math.random() * (b - a)
const smooth = (t) => t * t * (3 - 2 * t)

// ─── height-field насыпи ────────────────────────────────────────────────────
const PILE = { min: -2.3, max: 2.3, cap: 2.1 }
function makeField() {
  const N = 40
  const cw = (PILE.max - PILE.min) / N
  const data = new Float32Array(N * N)
  const maxStep = 0.72 * cw
  const ci = (v) => Math.min(N - 1, Math.max(0, Math.floor((v - PILE.min) / cw)))
  const relax = (i, j) => {
    const k = i * N + j; let mk = -1, mv = data[k]
    if (i > 0 && data[k - N] < mv) { mv = data[k - N]; mk = k - N }
    if (i < N - 1 && data[k + N] < mv) { mv = data[k + N]; mk = k + N }
    if (j > 0 && data[k - 1] < mv) { mv = data[k - 1]; mk = k - 1 }
    if (j < N - 1 && data[k + 1] < mv) { mv = data[k + 1]; mk = k + 1 }
    if (mk >= 0 && data[k] - mv > maxStep) { const m = (data[k] - mv - maxStep) * 0.5; data[k] -= m; data[mk] += m }
  }
  return {
    heightAt: (x, z) => (x < PILE.min || x > PILE.max || z < PILE.min || z > PILE.max) ? 0 : data[ci(x) * N + ci(z)],
    deposit: (x, z) => { const k = ci(x) * N + ci(z); return { k, surf: data[k] } },
    raise: (k, h) => { data[k] = Math.min(PILE.cap, data[k] + h); relax(Math.floor(k / N), k % N) },
    lower: (k, h) => { data[k] = Math.max(0, data[k] - h) },
  }
}

// ─── система вихревых частиц ────────────────────────────────────────────────
function makeVortex(count, addH, growSpan) {
  const s = {
    count, addH,
    x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count),
    th: new Float32Array(count), r: new Float32Array(count),
    w: new Float32Array(count), vin: new Float32Array(count), vfall: new Float32Array(count),
    phase: new Uint8Array(count), rel: new Float32Array(count), restUntil: new Float32Array(count),
    cell: new Int32Array(count), scale: new Float32Array(count), ra: new Float32Array(count), rspd: new Float32Array(count),
  }
  for (let i = 0; i < count; i++) reset(s, i, (i / count) * growSpan)
  return s
}
function reset(s, i, rel) {
  s.th[i] = Math.random() * Math.PI * 2
  s.r[i] = rand(4.5, 8)
  s.y[i] = rand(3.6, 6)
  s.w[i] = rand(3.4, 4.6)               // угловая скорость (когерентный вихрь)
  s.vin[i] = rand(1.6, 2.4)             // сжатие радиуса
  s.vfall[i] = rand(1.7, 2.6)           // падение
  s.phase[i] = FALL
  s.rel[i] = rel
  s.scale[i] = rand(0.7, 1.25)
  s.ra[i] = Math.random() * Math.PI
  s.rspd[i] = rand(0.4, 1.4)
  s.x[i] = Math.cos(s.th[i]) * s.r[i]
  s.z[i] = Math.sin(s.th[i]) * s.r[i]
}
function stepVortex(s, mesh, dummy, dq, dt, T, field, restDur) {
  for (let i = 0; i < s.count; i++) {
    let ph = s.phase[i]
    if (ph === FALL) {
      if (T < s.rel[i]) {                // ещё не выпущена: висит на верхнем кольце
        s.x[i] = Math.cos(s.th[i]) * s.r[i]; s.z[i] = Math.sin(s.th[i]) * s.r[i]
      } else {
        s.th[i] += s.w[i] * dt
        s.r[i] = Math.max(0.3, s.r[i] - s.vin[i] * dt)
        s.y[i] -= s.vfall[i] * dt
        s.x[i] = Math.cos(s.th[i]) * s.r[i]
        s.z[i] = Math.sin(s.th[i]) * s.r[i]
        s.ra[i] += s.rspd[i] * dt
        const surf = field.heightAt(s.x[i], s.z[i])
        if (s.y[i] <= surf) {
          const d = field.deposit(s.x[i], s.z[i])
          s.y[i] = d.surf; s.cell[i] = d.k; field.raise(d.k, s.addH)
          ph = REST; s.restUntil[i] = T + restDur + rand(-1.5, 1.5)
        }
      }
    } else if (ph === REST) {
      if (T >= s.restUntil[i]) { field.lower(s.cell[i], s.addH); reset(s, i, T + rand(0, 0.6)); ph = FALL }
    }
    s.phase[i] = ph
    dummy.position.set(s.x[i], s.y[i], s.z[i])
    dummy.rotation.set(s.ra[i] * 0.7, s.ra[i], s.ra[i] * 0.4)
    dummy.scale.setScalar(s.scale[i])
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

function Vortex() {
  const [gravelMap, sandMap] = useLoader(THREE.TextureLoader, ['/textures/gravel.webp', '/textures/sand.webp'])
  useMemo(() => { [gravelMap, sandMap].forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 4 }) }, [gravelMap, sandMap])

  const GN = MOBILE ? 800 : 1600
  const SN = MOBILE ? 1100 : 2200
  const gGeo = useMemo(() => new THREE.DodecahedronGeometry(0.085, 0), [])
  const sGeo = useMemo(() => new THREE.IcosahedronGeometry(0.05, 0), [])
  const gMat = useMemo(() => new THREE.MeshStandardMaterial({ map: gravelMap, roughness: 0.85, metalness: 0.04 }), [gravelMap])
  const sMat = useMemo(() => new THREE.MeshStandardMaterial({ map: sandMap, roughness: 0.95, metalness: 0.02 }), [sandMap])

  const field = useMemo(() => makeField(), [])
  const gravel = useMemo(() => makeVortex(GN, 0.028, REDUCE ? 0 : 3), [])
  const sand = useMemo(() => makeVortex(SN, 0.012, REDUCE ? 0 : 3.5), [])
  const gRef = useRef(); const sRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dq = useMemo(() => new THREE.Quaternion(), [])
  const acc = useRef(0)

  // reduced-motion: сразу «досыпаем» кучу оффлайн-прогоном
  useEffect(() => {
    if (!REDUCE) return
    for (let s = 0; s < 240; s++) {
      if (gRef.current) stepVortex(gravel, gRef.current, dummy, dq, 0.05, 999, field, 1e9)
      if (sRef.current) stepVortex(sand, sRef.current, dummy, dq, 0.05, 999, field, 1e9)
    }
  }, [])

  useFrame((_, dt) => {
    if (REDUCE) return
    acc.current += Math.min(dt, 0.05)
    const T = acc.current
    if (gRef.current) stepVortex(gravel, gRef.current, dummy, dq, Math.min(dt, 0.05), T, field, 8)
    if (sRef.current) stepVortex(sand, sRef.current, dummy, dq, Math.min(dt, 0.05), T, field, 8)
  })

  return (
    <>
      {/* тени частиц выключены (их тысячи) — контакт даёт ContactShadows, перф ↑ */}
      <instancedMesh ref={gRef} args={[gGeo, gMat, GN]} frustumCulled={false} />
      <instancedMesh ref={sRef} args={[sGeo, sMat, SN]} frustumCulled={false} />
    </>
  )
}

// пыль, ловящая свет
function Dust() {
  const ref = useRef()
  const { pos, N } = useMemo(() => {
    const N = MOBILE ? 60 : 130
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(-3, 3); pos[i * 3 + 1] = rand(0.2, 4); pos[i * 3 + 2] = rand(-3, 3) }
    return { pos, N }
  }, [])
  useFrame((_, dt) => {
    if (!ref.current || REDUCE) return
    const a = ref.current.geometry.attributes.position.array
    for (let i = 0; i < N; i++) { a[i * 3 + 1] += dt * 0.25; if (a[i * 3 + 1] > 4.2) a[i * 3 + 1] = 0.2 }
    ref.current.geometry.attributes.position.needsUpdate = true
  })
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" count={N} array={pos} itemSize={3} /></bufferGeometry>
      <pointsMaterial size={0.03} color="#ffe6b0" transparent opacity={0.5} depthWrite={false} sizeAttenuation />
    </points>
  )
}

function CalibCube() {
  const map = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512
    const ctx = cv.getContext('2d'); const s = 128
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { ctx.fillStyle = (x + y) % 2 ? '#161616' : '#f2ede1'; ctx.fillRect(x * s, y * s, s, s) }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t
  }, [])
  const ref = useRef()
  useFrame((_, dt) => { if (ref.current && !REDUCE) ref.current.rotation.y += dt * 0.2 })
  return (
    <mesh ref={ref} position={[2.7, 0.45, 1.4]} castShadow receiveShadow>
      <boxGeometry args={[0.9, 0.9, 0.9]} />
      <meshStandardMaterial map={map} roughness={0.55} metalness={0.05} />
    </mesh>
  )
}

function Backdrop() {
  const { scene } = useModel('/models/site_crane.glb')
  const obj = useMemo(() => {
    const s = scene.clone(true)
    const box = new THREE.Box3().setFromObject(s); const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const scl = 9 / (Math.max(size.x, size.y, size.z) || 1)
    s.scale.setScalar(scl); s.position.set(-center.x * scl - 3.5, -box.min.y * scl, -center.z * scl - 5)
    s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })
    return s
  }, [scene])
  return <primitive object={obj} />
}

function Camera() {
  useFrame((state) => {
    const t = REDUCE ? 0 : state.clock.elapsedTime
    // top-down изометрия, лёгкий дрейф
    const a = 0.62 + (REDUCE ? 0 : Math.sin(t * 0.06) * 0.06)
    const R = 12.5
    state.camera.position.set(Math.sin(a) * R, 11, Math.cos(a) * R)
    state.camera.lookAt(0, 0.9, 0)
  })
  return null
}

function Scene() {
  return (
    <>
      <Environment resolution={256}>
        <Lightformer intensity={2.4} position={[0, 6, 3]} scale={[12, 6, 1]} color="#fff2da" />
        <Lightformer intensity={1.0} position={[-6, 3, 1]} scale={[4, 6, 1]} color="#cfe0ff" />
        <Lightformer intensity={0.9} position={[6, 2, -3]} scale={[4, 4, 1]} color="#ffcf8f" />
      </Environment>
      <ambientLight intensity={0.4} />
      <directionalLight position={[7, 13, 6]} intensity={1.9} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <directionalLight position={[-7, 5, -4]} intensity={0.4} color="#c98a24" />

      {/* земля-грунт */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#4a4034" roughness={1} />
      </mesh>

      <Suspense fallback={null}><Backdrop /></Suspense>
      <Vortex />
      <Dust />
      <CalibCube />

      <ContactShadows position={[0, 0.01, 0.6]} scale={18} blur={2.4} far={7} opacity={0.5} resolution={1024} />
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
          camera={{ position: [8, 11, 9], fov: 32 }}>
          <Camera />
          <Suspense fallback={null}><Scene /></Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
