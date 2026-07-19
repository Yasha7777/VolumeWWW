import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'

// SCROLL-SCRUBBED HERO. Сотни текстурированных частиц — гравий (крупные фактурные
// камни) и песок (мелкие зёрна) — рассыпаны по экрану и СОБИРАЮТСЯ в единую кучу
// строго по позиции скролла секции. Прокрутил вниз — куча собралась, прокрутил
// назад — рассыпалась. Никаких setTimeout: прогресс = scrollY / высота секции.
// Канвас fixed во вьюпорте, поэтому куча собирается целиком в кадре и не «уезжает».
// InstancedMesh — обе кучи в двух draw call. Текстуры реального гравия/песка
// (public/textures) дают материал, а не абстрактные кубы.

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const GRAVEL_COUNT = 520
const SAND_COUNT   = 360
const smooth = (t) => t * t * (3 - 2 * t)

// Normal-карта, выведенная из самой текстуры (Sobel по яркости → tangent-space).
// Так блики/тени ложатся ровно по граням камней texture'ы, в отличие от
// AI-«normal map», который бы не совпал с альбедо. Считаем один раз в браузере,
// без кредитов и без сборочных зависимостей. Края читаем с заворотом (seamless).
function normalFromImage(image, strength, size = 512) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0, size, size)
  const px = ctx.getImageData(0, 0, size, size).data
  const lum = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255
  }
  const at = (x, y) => lum[((y + size) % size) * size + ((x + size) % size)]
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      let nx = -dx, ny = -dy, nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; nz /= len
      const o = (y * size + x) * 4
      out[o] = (nx * 0.5 + 0.5) * 255
      out[o + 1] = (ny * 0.5 + 0.5) * 255
      out[o + 2] = (nz * 0.5 + 0.5) * 255
      out[o + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(out, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.needsUpdate = true
  return tex
}

// Прогресс сборки = позиция скролла секции (0 вверху → 1 через ~1 экран).
function scrollProgress() {
  if (REDUCE) return 1
  const vh = window.innerHeight || 1
  return Math.min(Math.max((window.scrollY || 0) / (vh * 1.05), 0), 1)
}

// Предрасчёт: где частица рассыпана (scatter) и где она в куче (heap).
// R — радиус основания, H — высота вершины, spreadX/Y — разлёт по экрану.
function buildParticles(count, R, H, spreadX, spreadY, yBase, sMin, sMax, tint) {
  const gold  = new THREE.Color('#c98a24')
  const green = new THREE.Color('#2f4a1c')
  const stone = new THREE.Color('#8a8577')
  const c = new THREE.Color()
  const arr = []
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2
    const rr = Math.sqrt(Math.random()) * R
    const maxY = H * (1 - rr / R)
    const y = Math.random() * maxY
    const heap = [Math.cos(ang) * rr, yBase + y, Math.sin(ang) * rr]

    const scatter = [
      (Math.random() - 0.5) * spreadX,
      (Math.random() - 0.5) * spreadY + (Math.random() - 0.3) * 2,
      (Math.random() - 0.5) * 7 - 1,
    ]
    const rot = [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI]
    const s = sMin + Math.random() * (sMax - sMin)

    // лёгкая палитровая подкраска поверх текстуры: лес у земли → охра выше,
    // редкие камни. tint держим слабым, чтобы фактура текстуры доминировала.
    const tcol = maxY > 0 ? y / H : 0
    c.copy(green).lerp(gold, smooth(Math.min(tcol * 1.4, 1)))
    if (Math.random() < 0.2) c.lerp(stone, 0.5)
    c.lerp(new THREE.Color('#ffffff'), 1 - tint)  // приглушаем тинт

    arr.push({ scatter, heap, rot, s, color: c.clone() })
  }
  return arr
}

function Particles({ map, normalMap, normalScale, count, geometry, data, spinBase, roughness }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    data.forEach((d, i) => mesh.setColorAt(i, d.color))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [data])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    const e = smooth(scrollProgress())          // прямая привязка к скроллу

    for (let i = 0; i < count; i++) {
      const d = data[i]
      dummy.position.set(
        d.scatter[0] + (d.heap[0] - d.scatter[0]) * e,
        d.scatter[1] + (d.heap[1] - d.scatter[1]) * e,
        d.scatter[2] + (d.heap[2] - d.scatter[2]) * e,
      )
      const spin = (1 - e) * spinBase            // рассыпанные крутятся, собранные — замирают
      dummy.rotation.set(d.rot[0] + spin, d.rot[1] + spin, d.rot[2])
      dummy.scale.setScalar(d.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (!REDUCE) mesh.rotation.y += dt * 0.1 * e  // собранная куча медленно вращается
  })

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, count]}>
      <meshStandardMaterial
        map={map}
        normalMap={normalMap}
        normalScale={normalScale}
        roughness={roughness}
        metalness={0.05}
      />
    </instancedMesh>
  )
}

function Heap() {
  const [gravelMap, sandMap] = useLoader(THREE.TextureLoader, [
    '/textures/gravel.png',
    '/textures/sand.png',
  ])
  // цвет текстуры в sRGB, лёгкое повторение → на каждом камне читаемая фактура
  ;[gravelMap, sandMap].forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 2)
    t.anisotropy = 4
  })

  // рельеф из самих текстур → блики/тени по граням камней (не плоская наклейка)
  const gravelNormal = useMemo(() => normalFromImage(gravelMap.image, 2.4), [gravelMap])
  const sandNormal   = useMemo(() => normalFromImage(sandMap.image, 1.6), [sandMap])
  const gravelNScale = useMemo(() => new THREE.Vector2(0.9, 0.9), [])
  const sandNScale   = useMemo(() => new THREE.Vector2(0.6, 0.6), [])

  const gravelGeo = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  const sandGeo   = useMemo(() => new THREE.IcosahedronGeometry(1, 0), [])

  // гравий: крупные камни в конусе; песок: мелкие зёрна, шире и ниже (основание)
  // R — радиус основания, H — высота вершины. Варианты кучи см. в шапке файла.
  // ── КОМПАКТНАЯ (плотнее и выше) — активна ──
  const gravelData = useMemo(
    () => buildParticles(GRAVEL_COUNT, 2.1, 2.9, 12, 6, -0.95, 0.07, 0.13, 0.55),
    [],
  )
  const sandData = useMemo(
    () => buildParticles(SAND_COUNT, 2.7, 0.85, 13, 7, -1.05, 0.03, 0.055, 0.4),
    [],
  )
  // ── РАСКИДИСТАЯ (шире и ниже) — альтернатива ──
  //   gravel: buildParticles(GRAVEL_COUNT, 3.0, 2.2, 12, 6, -0.85, 0.07, 0.13, 0.55)
  //   sand:   buildParticles(SAND_COUNT, 3.6, 0.8, 13, 7, -1.0, 0.03, 0.055, 0.4)

  return (
    <>
      <Particles map={gravelMap} normalMap={gravelNormal} normalScale={gravelNScale}
                 count={GRAVEL_COUNT} geometry={gravelGeo}
                 data={gravelData} spinBase={1.4} roughness={0.7} />
      <Particles map={sandMap} normalMap={sandNormal} normalScale={sandNScale}
                 count={SAND_COUNT} geometry={sandGeo}
                 data={sandData} spinBase={0.8} roughness={0.95} />
    </>
  )
}

export default function CubesHeroImpl() {
  const wrapRef = useRef(null)

  // канвас fixed во вьюпорте; гаснет после того, как куча собралась → не мешает
  // контенту ниже. При reduced-motion остаётся статичная собранная куча.
  useEffect(() => {
    if (REDUCE) return
    const onScroll = () => {
      const vh = window.innerHeight || 1
      // мягче: куча держится собранной дольше (старт позже, диапазон длиннее)
      const fade = 1 - Math.min(Math.max((window.scrollY - vh * 1.35) / (vh * 0.9), 0), 1)
      if (wrapRef.current) wrapRef.current.style.opacity = String(fade)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div ref={wrapRef} className="kb-hero3d">
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0.7, 7.6], fov: 44 }}
        style={{ pointerEvents: 'none' }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 8, 5]} intensity={1.5} />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#c98a24" />
        <Suspense fallback={null}>
          <Heap />
        </Suspense>
      </Canvas>
    </div>
  )
}
