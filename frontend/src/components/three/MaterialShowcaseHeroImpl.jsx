import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows, useProgress, AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useModel } from './ktx2gltf'

/* ════════════════════════════════════════════════════════════════════════
   СЦЕНА СЕКЦИИ «ДВИЖОК» · МНОГО ИНСТАНСОВ гравия/песка/камня (геометрии из
   /models, meshopt+KTX2, полигоны целы) сыплются сверху и УКЛАДЫВАЮТСЯ В
   ПЛОТНЫЙ КОНУС-НАСЫПЬ, затем ЗАМИРАЮТ. Рядом калибровочный куб. Здание с
   краном — окружение сзади. reduced-motion → статичный собранный кадр.

   ПЕРФ-ИНВАРИАНТЫ (эталон — CubesHeroImpl):
   • видимость гейтит рендер: IntersectionObserver на обёртке → frameloop
     "always"↔"never" (работает В ЛЮБОЙ секции, не только вверху страницы);
   • dirty-check + ЗАТУХАНИЕ дрожи: после укладки матрицы инстансов больше не
     пересобираются (doneRef) — раньше drift не затухал и буфер жгли вечно;
   • useInstGeo объединяет ВСЕ меши модели (stone_gravel: 9 мешей; раньше
     брался только первый, 8 терялись) — безопасно, с фолбэком на largest;
   • ContactShadows frames={1} + ребейк по КВАНТУ прогресса сборки (≤15 раз),
     а не покадрово;
   • разумные счётчики: pile_of_gravel — это ЦЕЛАЯ куча, поэтому единицы штук,
     а не 1200 (куч внутри кучи).
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

// Достаём геометрию модели: ОБЪЕДИНЯЕМ все меши (не теряем 8 из 9), запекаем
// мировые матрицы, нормируем max-dim→1. Если меши разнородны (несовместимы для
// merge) — безопасный фолбэк на самый крупный меш, консоль чистая.
function bakeGeometryFromScene(scene) {
  scene.updateWorldMatrix(true, true)
  const baked = []
  scene.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const g = o.geometry.clone()
      g.applyMatrix4(o.matrixWorld)
      g.morphAttributes = {}                       // merge чувствителен к морфам
      baked.push({
        g,
        count: g.attributes.position.count,
        sig: Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 'i' : 'n'),
        mat: Array.isArray(o.material) ? o.material[0] : o.material,
      })
    }
  })
  if (!baked.length) return null
  const largest = baked.reduce((a, b) => (b.count > a.count ? b : a))
  const mat = largest.mat
  let geo = largest.g
  if (baked.length > 1) {
    const uniform = baked.every((b) => b.sig === baked[0].sig)
    if (uniform) {
      try {
        const merged = mergeGeometries(baked.map((b) => b.g), false)
        if (merged) geo = merged
      } catch { /* оставляем largest */ }
    }
  }
  geo.computeBoundingBox()
  const size = new THREE.Vector3(); geo.boundingBox.getSize(size)
  const c = new THREE.Vector3(); geo.boundingBox.getCenter(c)
  const s = 1 / (Math.max(size.x, size.y, size.z) || 1)
  geo.translate(-c.x, -c.y, -c.z); geo.scale(s, s, s)
  return { geo, mat }
}

function useInstGeo(url) {
  const { scene } = useModel(url)
  return useMemo(() => bakeGeometryFromScene(scene), [scene])
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
  const doneRef = useRef(false)
  const lastT = useRef(-1)
  // момент, когда уложится последняя частица (rel + окно падения 1.6) + запас
  const settleT = useMemo(() => data.reduce((m, d) => Math.max(m, d.rel), 0) + 1.7, [data])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh || doneRef.current) return          // после сборки буфер не трогаем
    const t = REDUCE ? 99 : tRef.current
    if (!REDUCE && Math.abs(t - lastT.current) < 1e-3) return  // dirty-check: t не сдвинулся
    lastT.current = t
    for (let i = 0; i < data.length; i++) {
      const d = data[i]
      const s = REDUCE ? 1 : smooth(seg(t, d.rel, d.rel + 1.6))
      // дрожь ЗАТУХАЕТ по мере укладки (×(1-s)) → после сборки строго 0
      const drift = REDUCE ? 0 : Math.sin(t * 0.8 + d.ph) * 0.006 * (1 - s)
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
    if (REDUCE || t >= settleT) doneRef.current = true   // фиксируем финальную укладку
  })
  // тени частиц выключены (их тысячи) — контакт даёт ContactShadows
  return <instancedMesh ref={ref} args={[geo, mat, data.length]} frustumCulled={false} receiveShadow />
}

// один материал → InstancedMesh с упаковкой в конус
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
  const shadowBucketRef = useRef(0)
  const [shadowBucket, setShadowBucket] = useState(0)

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

    // ребейк тени по кванту прогресса сборки: тень идёт за кучей, но ≤15 раз
    // (а не покадрово). tRef растёт ТОЛЬКО пока сцена видна → бакеты меняются
    // лишь во время реальной укладки, потом замирают.
    if (!REDUCE) {
      const b = Math.min(14, Math.floor(tRef.current / 0.4))
      if (b !== shadowBucketRef.current) { shadowBucketRef.current = b; setShadowBucket(b) }
    }
  })

  return (
    <>
      <Environment resolution={256}>
        <Lightformer intensity={2.4} position={[0, 7, 4]} scale={[14, 7, 1]} color="#fff2da" />
        <Lightformer intensity={1.0} position={[-7, 3, 1]} scale={[5, 7, 1]} color="#cfe0ff" />
        <Lightformer intensity={0.9} position={[7, 2, -3]} scale={[5, 5, 1]} color="#ffcf8f" />
      </Environment>
      <ambientLight intensity={0.4} />
      <directionalLight position={[7, 14, 7]} intensity={1.9} castShadow={!MOBILE}
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
      <directionalLight position={[-8, 5, -4]} intensity={0.4} color="#c98a24" />

      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#4a4034" roughness={1} />
      </mesh>

      {/* ЗДАНИЕ с краном — ОКРУЖЕНИЕ СЗАДИ. МАКС.ОПТИМ: только на десктопе
          (site_crane ~12МБ) — на мобиле не грузим вовсе. */}
      {!MOBILE && (
        <group ref={buildingRef} position={[0, 0, -9.5]} rotation={[0, -0.35, 0]}>
          <Suspense fallback={null}><Building url="/models/site_crane.glb" target={13} /></Suspense>
        </group>
      )}

      {/* ПЛОТНАЯ КУЧА из ИНСТАНСОВ block_sand_rock (сыплются сверху → укладываются →
          замирают). МАКС.ОПТИМ: убраны stone_gravel и pile_of_gravel (≈17МБ и лишние
          draw-calls; куча целиком строится из одной геометрии), счётчик снижен. */}
      <group position={[0, 0, 0.2]}>
        <Suspense fallback={null}>
          <MaterialInstances url="/models/block_sand_rock.glb" count={MOBILE ? 1600 : 4000} sMin={0.020} sMax={0.038} span={2.8} tRef={tRef} />
        </Suspense>
      </group>

      <CalibCube tRef={tRef} />

      <ContactShadows key={shadowBucket} position={[0, 0.01, 0.4]} scale={16} blur={2.4} far={7} opacity={0.55} resolution={512} frames={1} />
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
  const visibleRef = useRef(false)
  const [frameloop, setFrameloop] = useState('never')   // включим, когда секция реально в кадре
  const [mounted, setMounted] = useState(false)

  // отложенный маунт канваса — не блокируем первый paint компиляцией PBR-шейдеров
  useEffect(() => { const raf = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(raf) }, [])

  // Гейт рендера ПО ВИДИМОСТИ СЕКЦИИ (а не по scrollY от верха страницы) — сцена
  // живёт в «Движке» посреди страницы. reduced-motion → 'demand' (один кадр).
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
      <Loader />
      {mounted && (
        <Canvas frameloop={REDUCE ? 'demand' : frameloop} shadows={!MOBILE} dpr={MOBILE ? [1, 1] : [1, 1.25]}
          gl={{ alpha: true, antialias: !MOBILE, powerPreference: 'high-performance' }}
          camera={{ position: [6, 16, 12], fov: 40, near: 0.25, far: 200 }}>
          <Suspense fallback={null}><Scene /></Suspense>
          <AdaptiveDpr pixelated />
        </Canvas>
      )}
    </div>
  )
}
