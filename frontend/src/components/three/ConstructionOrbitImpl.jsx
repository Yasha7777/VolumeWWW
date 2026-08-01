import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

/* ════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ · «ОБЛЁТ СТРОЙПЛОЩАДКИ». Технология движущихся объектов из NovaAI-
   референса (scroll-scrubbed), но вместо видео — реальные 3D-модели: песок
   (sand.glb) + гравий (gravel.glb) + процедурные шахматные кубы ОБЛЕТАЮТ
   строительную площадку (site.glb) по мере прокрутки ВСЕЙ страницы. Канвас
   fixed на весь лайфтайм: объекты кружат вокруг сцены и просвечивают сквозь
   стеклянный контент. Перф: гейт по document.hidden/reduced-motion, скролл
   сглажен lerp'ом (масляно), модели инстансятся (3 draw call на россыпь),
   dpr[1,1.5], отложенный маунт. Модели сжаты gltf-transform (quantize+webp),
   нативно грузятся three.js без Draco-декодера.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const TWO_PI = Math.PI * 2

const SAND = '/models/sand.glb'
const GRAVEL = '/models/gravel.glb'
const SITE = '/models/site.glb'
useGLTF.preload(SAND)
useGLTF.preload(GRAVEL)
useGLTF.preload(SITE)

const ric = (fn) =>
  (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(fn, { timeout: 1400 })
    : setTimeout(fn, 200)
const cancelRic = (id) =>
  (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? window.cancelIdleCallback(id)
    : clearTimeout(id)

// глобальный прогресс скролла (0 вверху страницы → 1 внизу), как в NovaAI
function scrollProgress() {
  if (typeof window === 'undefined') return 0
  const h = document.documentElement.scrollHeight - window.innerHeight
  return h > 0 ? Math.min(Math.max(window.scrollY / h, 0), 1) : 0
}

// достаём из GLB одну геометрию + материал, запекаем мировую матрицу и
// нормируем в единичную сферу (радиус 0.5) — дальше масштабируем инстансами
function prepareGeometry(scene) {
  let picked = null
  scene.updateWorldMatrix(true, true)
  scene.traverse((o) => {
    if (o.isMesh && o.geometry && !picked) {
      const g = o.geometry.clone()
      g.applyMatrix4(o.matrixWorld)
      picked = { geo: g, mat: Array.isArray(o.material) ? o.material[0] : o.material }
    }
  })
  if (!picked) return null
  picked.geo.computeBoundingSphere()
  const bs = picked.geo.boundingSphere
  const s = 0.5 / (bs.radius || 1)
  picked.geo.translate(-bs.center.x, -bs.center.y, -bs.center.z)
  picked.geo.scale(s, s, s)
  return picked
}

// процедурная шахматка 4×4
function checkerTexture(cells = 4, px = 256) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const ctx = cv.getContext('2d')
  const st = px / cells
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#141414' : '#f3efe6'
      ctx.fillRect(x * st, y * st, st, st)
    }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// параметры орбиты одного объекта: кольцо вокруг центра + фаза + наклон + спин
function makeOrbits(count, rMin, rMax, sMin, sMax) {
  const arr = []
  for (let i = 0; i < count; i++) {
    arr.push({
      radius: rMin + Math.random() * (rMax - rMin),
      phase: Math.random() * TWO_PI,
      tilt: (Math.random() - 0.5) * 0.5,               // наклон плоскости кольца
      y: (Math.random() - 0.5) * 4,
      yWob: 0.5 + Math.random() * 1.4,
      turns: 0.5 + Math.random() * 1.6,                // сколько оборотов за прокрутку
      dir: Math.random() < 0.5 ? 1 : -1,
      idle: 0.05 + Math.random() * 0.12,               // скорость холостого дрейфа
      gather: 0.6 + Math.random() * 1.8,               // насколько подтягивается к центру
      s: sMin + Math.random() * (sMax - sMin),
      spin: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
      spinSpd: 0.2 + Math.random() * 0.5,
      quat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
      ),
    })
  }
  return arr
}

// общий сглаженный прогресс (lerp) — заводим на общий ref
function Orbiters({ progress }) {
  const sandGltf = useGLTF(SAND)
  const gravelGltf = useGLTF(GRAVEL)
  const sand = useMemo(() => prepareGeometry(sandGltf.scene), [sandGltf])
  const gravel = useMemo(() => prepareGeometry(gravelGltf.scene), [gravelGltf])
  const cubeGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const cubeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: checkerTexture(4), roughness: 0.5, metalness: 0.05 }),
    [],
  )

  const sandRef = useRef()
  const gravelRef = useRef()
  const cubeRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dq = useMemo(() => new THREE.Quaternion(), [])

  const sandOrbits = useMemo(() => makeOrbits(40, 4.2, 9.5, 0.5, 1.1), [])
  const gravelOrbits = useMemo(() => makeOrbits(26, 3.6, 8.5, 0.7, 1.5), [])
  const cubeOrbits = useMemo(() => makeOrbits(22, 3.2, 8.8, 0.35, 0.7), [])

  const writeSet = (mesh, orbits, p, t) => {
    if (!mesh) return
    for (let i = 0; i < orbits.length; i++) {
      const o = orbits[i]
      const ang = o.phase + p * o.turns * TWO_PI * o.dir + t * o.idle * o.dir
      const r = o.radius - p * o.gather                 // на скролле стягиваются к площадке
      const ct = Math.cos(o.tilt), st = Math.sin(o.tilt)
      const x = Math.cos(ang) * r
      const zc = Math.sin(ang) * r
      dummy.position.set(x, o.y + Math.sin(ang + o.phase) * o.yWob + st * zc, zc * ct)
      if (!REDUCE) { dq.setFromAxisAngle(o.spin, 0.016 * o.spinSpd); o.quat.multiply(dq) }
      dummy.quaternion.copy(o.quat)
      dummy.scale.setScalar(o.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  useFrame((state) => {
    const p = progress.current
    const t = REDUCE ? 0 : state.clock.elapsedTime
    writeSet(sandRef.current, sandOrbits, p, t)
    writeSet(gravelRef.current, gravelOrbits, p, t)
    writeSet(cubeRef.current, cubeOrbits, p, t)
  })

  return (
    <>
      {sand && <instancedMesh ref={sandRef} args={[sand.geo, sand.mat, sandOrbits.length]} />}
      {gravel && <instancedMesh ref={gravelRef} args={[gravel.geo, gravel.mat, gravelOrbits.length]} />}
      <instancedMesh ref={cubeRef} args={[cubeGeo, cubeMat, cubeOrbits.length]} />
    </>
  )
}

// строительная площадка в центре — медленно поворачивается с прокруткой
function Site({ progress }) {
  const { scene } = useGLTF(SITE)
  const ref = useRef()
  const prepared = useMemo(() => {
    const root = scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const maxd = Math.max(size.x, size.y, size.z) || 1
    const s = 6.5 / maxd
    root.position.set(-center.x * s, -box.min.y * s - 1.8, -center.z * s)
    root.scale.setScalar(s)
    return root
  }, [scene])

  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = progress.current * TWO_PI * 0.6 + (REDUCE ? 0 : state.clock.elapsedTime * 0.03)
  })

  return <group ref={ref}><primitive object={prepared} /></group>
}

export default function ConstructionOrbitImpl() {
  const wrapRef = useRef(null)
  const progress = useRef(REDUCE ? 1 : 0)
  const target = useRef(REDUCE ? 1 : 0)
  const [frameloop, setFrameloop] = useState('always')
  const [mounted, setMounted] = useState(false)

  // целевой прогресс из скролла + плавность (lerp в rAF-петле канваса ниже)
  useEffect(() => {
    if (REDUCE) return
    const onScroll = () => { target.current = scrollProgress() }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])

  // гейт рендера: вкладка скрыта → замираем
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? 'never' : 'always')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // reduced-motion: даём собраться и замираем
  useEffect(() => {
    if (!REDUCE) return
    const t = setTimeout(() => setFrameloop('never'), 1400)
    return () => clearTimeout(t)
  }, [])

  // отложенный маунт — не блокируем первый paint
  useEffect(() => {
    let id
    const raf = requestAnimationFrame(() => { id = ric(() => setMounted(true)) })
    return () => { cancelAnimationFrame(raf); if (id != null) cancelRic(id) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-orbit">
      {mounted && (
        <Canvas
          frameloop={frameloop}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ position: [0, 2.2, 13], fov: 42 }}
          onCreated={({ camera }) => camera.lookAt(0, 0.5, 0)}
          style={{ pointerEvents: 'none' }}
        >
          {/* сглаживание прогресса每кадр + лёгкий пан камеры по скроллу */}
          <Rig progress={progress} target={target} />
          <ambientLight intensity={0.85} />
          <directionalLight position={[6, 10, 6]} intensity={1.5} castShadow={false} />
          <directionalLight position={[-6, 4, -5]} intensity={0.55} color="#c98a24" />
          <Suspense fallback={null}>
            <Site progress={progress} />
            <Orbiters progress={progress} />
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}

// сглаживает target→progress (lerp 0.08) и слегка водит камеру по орбите скролла
function Rig({ progress, target }) {
  useFrame((state) => {
    progress.current += (target.current - progress.current) * 0.08
    const p = progress.current
    if (!REDUCE) {
      const a = p * 0.6
      state.camera.position.x = Math.sin(a) * 13
      state.camera.position.z = Math.cos(a) * 13
      state.camera.position.y = 2.2 + p * 1.5
      state.camera.lookAt(0, 0.5, 0)
    }
  })
  return null
}
