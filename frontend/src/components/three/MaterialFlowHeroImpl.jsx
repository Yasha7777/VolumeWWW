import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* ════════════════════════════════════════════════════════════════════════
   HERO ЛЕНДИНГА · физический процесс: сыпучий материал (песок+гравий)
   распределён вокруг здания → организованным потоком ОБЛЕТАЕТ его → влетает
   в ПРОЁМ → падает внутри → из прилетающих частиц ФОРМИРУЕТСЯ КУЧА (height-
   field с углом естественного откоса). Не декоративные точки и не «готовая
   куча». Time-driven цикл: каждая частица SUPPLY→ORBIT→APPROACH→INSIDE→
   DEPOSIT→(rest)→SUPPLY, поэтому куча растёт из пустоты и держится в steady-
   state (приход ≈ уход). Перф: instancing (2 draw call), CPU-физика по
   типизированным массивам, frameloop-гейт по видимости, dpr[1,1.5],
   отложенный маунт, reduced-motion → статичная финальная куча.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const MOBILE = typeof window !== 'undefined' && window.innerWidth < 700

// фазы
const SUPPLY = 0, ORBIT = 1, APPROACH = 2, INSIDE = 3, DEPOSIT = 4

// геометрия здания (мировые единицы)
const B = { hw: 4, hd: 3, h: 4, gateHW: 1.7, gateH: 3, gateZ: 3 }
// зона кучи (интерьер) + центр насыпи (чуть в глубину от ворот)
const PILE = { minX: -3.4, maxX: 3.4, minZ: -2.4, maxZ: 2.4, cx: 0, cz: -0.4, max: 2.3 }
const GRID = 44
const GRAV = 6.5

const ric = (fn) => (typeof window !== 'undefined' && window.requestIdleCallback)
  ? window.requestIdleCallback(fn, { timeout: 1400 }) : setTimeout(fn, 200)
const cancelRic = (id) => (typeof window !== 'undefined' && window.cancelIdleCallback)
  ? window.cancelIdleCallback(id) : clearTimeout(id)

const rand = (a, b) => a + Math.random() * (b - a)

// ─── height-field кучи ─────────────────────────────────────────────────────
function makeField() {
  const N = GRID
  const cw = (PILE.maxX - PILE.minX) / N
  const cd = (PILE.maxZ - PILE.minZ) / N
  const data = new Float32Array(N * N)
  const maxStep = 0.7 * Math.max(cw, cd)      // угол естественного откоса ~35°
  const ci = (x) => Math.min(N - 1, Math.max(0, Math.floor((x - PILE.minX) / cw)))
  const cj = (z) => Math.min(N - 1, Math.max(0, Math.floor((z - PILE.minZ) / cd)))
  const heightAt = (x, z) => {
    if (x < PILE.minX || x > PILE.maxX || z < PILE.minZ || z > PILE.maxZ) return 0
    return data[ci(x) * N + cj(z)]
  }
  // разлить избыток к самому низкому соседу (скатывание по склону)
  const relax = (i, j) => {
    const k = i * N + j
    let mk = -1, mv = data[k]
    if (i > 0 && data[(i - 1) * N + j] < mv) { mv = data[(i - 1) * N + j]; mk = (i - 1) * N + j }
    if (i < N - 1 && data[(i + 1) * N + j] < mv) { mv = data[(i + 1) * N + j]; mk = (i + 1) * N + j }
    if (j > 0 && data[i * N + j - 1] < mv) { mv = data[i * N + j - 1]; mk = i * N + j - 1 }
    if (j < N - 1 && data[i * N + j + 1] < mv) { mv = data[i * N + j + 1]; mk = i * N + j + 1 }
    if (mk >= 0 && data[k] - mv > maxStep) {
      const move = (data[k] - mv - maxStep) * 0.5
      data[k] -= move; data[mk] += move
    }
  }
  return {
    data, heightAt,
    // положить частицу: вернуть поверхность (Y покоя) + поднять поле + релакс
    deposit(x, z) {
      const i = ci(x), j = cj(z), k = i * N + j
      const surf = data[k]
      return { k, surf }
    },
    raise(k, h) { data[k] = Math.min(PILE.max, data[k] + h); relax(Math.floor(k / N), k % N) },
    lower(k, h) { data[k] = Math.max(0, data[k] - h) },
  }
}

// ─── система частиц (типизированные массивы) ────────────────────────────────
function makeSystem(count, growSpan) {
  const s = {
    count,
    px: new Float32Array(count), py: new Float32Array(count), pz: new Float32Array(count),
    vx: new Float32Array(count), vy: new Float32Array(count), vz: new Float32Array(count),
    sx: new Float32Array(count), sy: new Float32Array(count), sz: new Float32Array(count), // supply
    phase: new Uint8Array(count), rel: new Float32Array(count), restUntil: new Float32Array(count),
    orbA: new Float32Array(count), orbR: new Float32Array(count), orbY: new Float32Array(count),
    orbDir: new Float32Array(count), orbSpd: new Float32Array(count), orbT: new Float32Array(count),
    entryX: new Float32Array(count), cell: new Int32Array(count), addH: new Float32Array(count),
    scale: new Float32Array(count), ra: new Float32Array(count), rspd: new Float32Array(count),
  }
  const zones = 6
  for (let i = 0; i < count; i++) {
    // зона подачи вокруг здания (видимые «навалы» материала снаружи)
    const zi = i % zones
    const za = (zi / zones) * Math.PI * 2 + rand(-0.25, 0.25)
    const zr = rand(7.5, 10.5)
    s.sx[i] = Math.cos(za) * zr + rand(-1.3, 1.3)
    s.sy[i] = rand(0.03, 0.5)
    s.sz[i] = Math.sin(za) * zr + rand(-1.3, 1.3)
    s.px[i] = s.sx[i]; s.py[i] = s.sy[i]; s.pz[i] = s.sz[i]
    s.phase[i] = SUPPLY
    s.rel[i] = (i / count) * growSpan + rand(0, 0.8)   // ступенчатый релиз (рост кучи)
    s.orbR[i] = rand(6.5, 11)
    s.orbY[i] = rand(1.2, 4)
    s.orbDir[i] = Math.random() < 0.5 ? 1 : -1
    s.orbSpd[i] = rand(0.4, 0.9)
    s.orbT[i] = rand(2.6, 6.5)
    s.entryX[i] = rand(-1.2, 1.2)
    s.scale[i] = 1
    s.ra[i] = rand(0, Math.PI)
    s.rspd[i] = rand(0.5, 1.8)
  }
  return s
}

function stepSystem(s, mesh, dummy, dt, t, field, restDur, gap) {
  const count = s.count
  for (let i = 0; i < count; i++) {
    let ph = s.phase[i]
    let px = s.px[i], py = s.py[i], pz = s.pz[i]

    if (ph === SUPPLY) {
      px = s.sx[i]; py = s.sy[i]; pz = s.sz[i]
      if (t >= s.rel[i]) { ph = ORBIT; s.orbA[i] = Math.atan2(pz, px) }
    } else if (ph === ORBIT) {
      s.orbA[i] += s.orbDir[i] * s.orbSpd[i] * dt
      const a = s.orbA[i]
      const dx = Math.cos(a) * s.orbR[i]
      const dz = Math.sin(a) * s.orbR[i]
      const dy = s.orbY[i] + Math.sin(t * 0.6 + i) * 0.3
      const k = Math.min(1, dt * 2.4)          // плавное следование по дуге
      px += (dx - px) * k; py += (dy - py) * k; pz += (dz - pz) * k
      s.orbT[i] -= dt
      if (s.orbT[i] <= 0) { ph = APPROACH; s.vx[i] = s.vy[i] = s.vz[i] = 0 }
    } else if (ph === APPROACH) {
      // цель — устье ворот (по ширине проёма), затем реально пересечь плоскость
      const tx = s.entryX[i], ty = 1.5, tz = B.gateZ + 0.25
      const sp = 7
      s.vx[i] += (tx - px) * dt * 3.2; s.vy[i] += (ty - py) * dt * 3.2; s.vz[i] += (tz - pz) * dt * 3.2
      const vl = Math.hypot(s.vx[i], s.vy[i], s.vz[i]) || 1
      const cl = Math.min(sp, vl) / vl
      s.vx[i] *= cl; s.vy[i] *= cl; s.vz[i] *= cl
      px += s.vx[i] * dt; py += s.vy[i] * dt; pz += s.vz[i] * dt
      // реальное пересечение проёма внутрь (z уходит за фронтальную плоскость)
      if (pz < B.gateZ && Math.abs(px) < B.gateHW && py < B.gateH) ph = INSIDE
    } else if (ph === INSIDE) {
      s.vy[i] -= GRAV * dt
      s.vx[i] += (PILE.cx - px) * dt * 1.6; s.vz[i] += (PILE.cz - pz) * dt * 1.6
      s.vx[i] *= 0.985; s.vz[i] *= 0.985
      px += s.vx[i] * dt; py += s.vy[i] * dt; pz += s.vz[i] * dt
      const surf = field.heightAt(px, pz)
      if (py <= surf) {
        const d = field.deposit(px, pz)
        py = d.surf; s.cell[i] = d.k
        field.raise(d.k, s.addH[i])
        ph = DEPOSIT; s.restUntil[i] = t + restDur + rand(-1.5, 1.5)
        s.vx[i] = s.vy[i] = s.vz[i] = 0
      } else if (py < -0.5) {              // страховка: промахнулась мимо кучи
        py = field.heightAt(px, pz); const d = field.deposit(px, pz)
        s.cell[i] = d.k; field.raise(d.k, s.addH[i]); ph = DEPOSIT; s.restUntil[i] = t + restDur
      }
    } else if (ph === DEPOSIT) {
      if (t >= s.restUntil[i]) {            // рецикл: убрать из кучи, вернуть в подачу
        field.lower(s.cell[i], s.addH[i])
        ph = SUPPLY; s.rel[i] = t + gap + rand(0, 1.2)
        px = s.sx[i]; py = s.sy[i]; pz = s.sz[i]
      }
    }

    s.phase[i] = ph; s.px[i] = px; s.py[i] = py; s.pz[i] = pz
    dummy.position.set(px, py, pz)
    if (ph !== DEPOSIT && ph !== SUPPLY && !REDUCE) s.ra[i] += s.rspd[i] * dt
    dummy.rotation.set(s.ra[i] * 0.7, s.ra[i], s.ra[i] * 0.4)
    dummy.scale.setScalar(s.scale[i])
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

function Flow() {
  const sandRef = useRef(); const gravRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const field = useMemo(() => makeField(), [])

  const SAND_N = MOBILE ? 1200 : 2400
  const GRAV_N = MOBILE ? 380 : 800
  const sand = useMemo(() => {
    const s = makeSystem(SAND_N, 15)
    for (let i = 0; i < s.count; i++) { s.scale[i] = rand(0.7, 1.2); s.addH[i] = 0.010 }
    return s
  }, [])
  const grav = useMemo(() => {
    const s = makeSystem(GRAV_N, 16)
    for (let i = 0; i < s.count; i++) { s.scale[i] = rand(0.75, 1.35); s.addH[i] = 0.030 }
    return s
  }, [])

  const sandGeo = useMemo(() => new THREE.IcosahedronGeometry(0.05, 0), [])
  const gravGeo = useMemo(() => new THREE.DodecahedronGeometry(0.11, 0), [])
  const sandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8c9a6', roughness: 0.95, metalness: 0.02 }), [])
  const gravMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8f887a', roughness: 0.8, metalness: 0.04 }), [])

  // цветовая вариация гравия (камни различимы)
  useEffect(() => {
    const m = gravRef.current; if (!m) return
    const c = new THREE.Color()
    for (let i = 0; i < grav.count; i++) {
      c.setHSL(0.09 + Math.random() * 0.05, 0.12, 0.42 + Math.random() * 0.22)
      m.setColorAt(i, c)
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [grav])

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05)          // clamp больших шагов (таб-свитч)
    const t = state.clock.elapsedTime
    if (sandRef.current) stepSystem(sand, sandRef.current, dummy, d, t, field, 11, 1.2)
    if (gravRef.current) stepSystem(grav, gravRef.current, dummy, d, t, field, 11, 1.4)
  })

  return (
    <>
      <instancedMesh ref={sandRef} args={[sandGeo, sandMat, SAND_N]} frustumCulled={false} />
      <instancedMesh ref={gravRef} args={[gravGeo, gravMat, GRAV_N]} frustumCulled={false} />
    </>
  )
}

// ─── процедурное здание: тёмное стекло + охряные рёбра, открытые ворота ──────
function Building() {
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a241a', roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false,
  }), [])
  const floorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#14170f', roughness: 1 }), [])
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#b87a18', transparent: true, opacity: 0.55 }), [])
  const { hw, hd, h, gateHW, gateH } = B

  const Wall = ({ args, position }) => {
    const geo = useMemo(() => new THREE.BoxGeometry(...args), args)
    return (
      <group position={position}>
        <mesh geometry={geo} material={wallMat} />
        <lineSegments material={edgeMat}><edgesGeometry args={[geo]} /></lineSegments>
      </group>
    )
  }

  return (
    <group>
      {/* пол интерьера + двора */}
      <mesh material={floorMat} position={[0, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[hw * 2 + 0.4, hd * 2 + 0.4]} />
      </mesh>
      {/* задняя и боковые стены */}
      <Wall args={[hw * 2, h, 0.08]} position={[0, h / 2, -hd]} />
      <Wall args={[0.08, h, hd * 2]} position={[-hw, h / 2, 0]} />
      <Wall args={[0.08, h, hd * 2]} position={[hw, h / 2, 0]} />
      {/* передняя стена с ВОРОТАМИ: два простенка + перемычка */}
      <Wall args={[hw - gateHW, h, 0.08]} position={[-(gateHW + (hw - gateHW) / 2), h / 2, hd]} />
      <Wall args={[hw - gateHW, h, 0.08]} position={[gateHW + (hw - gateHW) / 2, h / 2, hd]} />
      <Wall args={[gateHW * 2, h - gateH, 0.08]} position={[0, gateH + (h - gateH) / 2, hd]} />
      {/* лёгкая полупрозрачная крыша */}
      <Wall args={[hw * 2, 0.08, hd * 2]} position={[0, h, 0]} />
    </group>
  )
}

// ─── камера: медленный осциллирующий облёт, здание+ворота+интерьер видны ────
function CameraRig() {
  useFrame((state) => {
    if (REDUCE) { state.camera.position.set(7, 4.6, 11); state.camera.lookAt(0, 1.1, -0.2); return }
    const t = state.clock.elapsedTime
    const az = Math.sin(t * 0.12) * 0.55            // ±~31°
    const rad = 12.5 - Math.sin(t * 0.08) * 1.6     // лёгкий zoom-in
    state.camera.position.set(Math.sin(az) * rad, 4.4 + Math.sin(t * 0.1) * 0.5, Math.cos(az) * rad)
    state.camera.lookAt(0, 1.15, -0.2)
  })
  return null
}

export default function MaterialFlowHeroImpl() {
  const wrapRef = useRef(null)
  const visibleRef = useRef(true)
  const [frameloop, setFrameloop] = useState('always')
  const [mounted, setMounted] = useState(false)

  // гейт: гаснет и замирает, когда hero ушёл за скролл
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
    let id; const raf = requestAnimationFrame(() => { id = ric(() => setMounted(true)) })
    return () => { cancelAnimationFrame(raf); if (id != null) cancelRic(id) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-flow">
      {mounted && (
        <Canvas
          frameloop={frameloop}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [7, 4.6, 12], fov: 40 }}
          style={{ pointerEvents: 'none' }}
        >
          <CameraRig />
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#cfd8c8', '#0b0d08', 0.5]} />
          <directionalLight position={[6, 11, 8]} intensity={1.5} />
          <directionalLight position={[-7, 5, -4]} intensity={0.5} color="#c98a24" />
          <Building />
          <Flow />
        </Canvas>
      )}
    </div>
  )
}
