import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
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

// Плоская 1×1 normal-заглушка (RGB 128,128,255 = нормаль +Z, нулевое возмущение).
// Материал создаётся сразу с НЕЙ в normalMap → шейдер компилится с USE_NORMALMAP
// один раз при первом рендере. Реальную Sobel-карту потом просто ПОДМЕНЯЕМ в
// тот же слот (обе текстуры non-null → тот же program cache key → БЕЗ второй
// перекомпиляции). Визуально плоская нормаль = как будто карты нет.
const FLAT_NORMAL = new THREE.DataTexture(
  new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat,
)
FLAT_NORMAL.needsUpdate = true

// TEXT-SAFE ZONE. Эллипс по центру кадра (в мировых XY на плоскости частиц),
// куда попадает заголовок. Частицы/кубы туда не лезут — обрамляют текст, а не
// лежат на нём. Ориентир ~55% ширины × 45% высоты видимой области. Экранный
// центр камеры смотрит вдоль -z из y≈0.7, при fov44/z7.6 видимая полувысота ≈3.1
// → полуоси ниже. Проверяем только (x,y), глубину z игнорируем (важна перекрытие
// текста в кадре). Дополнительно центр гарантированно чистит скрим (см. CSS).
// ax/ay расширены ещё на ~15% (2.5→2.88, 1.45→1.67) — «колодец» вокруг заголовка
// стал шире, буквам больше воздуха над гравием.
const SAFE = { cx: 0, cy: 0.7, ax: 2.88, ay: 1.67, inner: 0.8 }
// нормированный «радиус» точки в зоне: 0 в центре, 1 на внешней границе эллипса
function zoneDist(x, y) {
  return Math.hypot(x / SAFE.ax, (y - SAFE.cy) / SAFE.ay)
}
// вероятность СОХРАНИТЬ частицу: 0 внутри жёсткого ядра (inner) → плавный feather
// → 1 за внешней границей. Внутренний эллипс = чистый «колодец» без частиц вообще,
// край растушёван к внешней границе (без резкой кромки).
function zoneKeep(x, y) {
  const d = zoneDist(x, y)
  if (d >= 1) return 1
  if (d <= SAFE.inner) return 0
  return smooth((d - SAFE.inner) / (1 - SAFE.inner))
}
// жёсткая проверка «внутри внешней зоны» — для крупных кубов (держим их снаружи)
function inZone(x, y) {
  return zoneDist(x, y) < 1
}

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

// requestIdleCallback с фолбэком (Safari его не поддерживает).
const ric = (fn) =>
  (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(fn, { timeout: 1200 })
    : setTimeout(fn, 200)
const cancelRic = (id) =>
  (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? window.cancelIdleCallback(id)
    : clearTimeout(id)

// Квантованный прогресс скролла (бакет) — источник ре-бейка тени. React-стейт
// обновляется ТОЛЬКО при смене бакета (≤ steps раз за весь скролл), а не 60/сек.
function useScrollBucket(steps = 24) {
  const [bucket, setBucket] = useState(() => Math.round(scrollProgress() * steps))
  useEffect(() => {
    if (REDUCE) return
    const onScroll = () => {
      const b = Math.round(scrollProgress() * steps)
      setBucket((prev) => (prev === b ? prev : b))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [steps])
  return bucket
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
    // куча: точку принимаем с вероятностью zoneKeep — жёсткий «колодец» по центру
    // под заголовком + растушёванный край. Так частицы обрамляют текст без кромки.
    let ang, rr, maxY, y, heap, placed = false
    for (let t = 0; t < 10; t++) {
      ang = Math.random() * Math.PI * 2
      rr = Math.sqrt(Math.random()) * R
      maxY = H * (1 - rr / R)
      y = Math.random() * maxY
      heap = [Math.cos(ang) * rr, yBase + y, Math.sin(ang) * rr]
      if (Math.random() < zoneKeep(heap[0], heap[1])) { placed = true; break }
    }
    if (!placed) continue   // попала в колодец → частицы там нет вообще

    // рассыпанное состояние — по тому же правилу, иначе текст перекрыт наверху скролла
    let scatter, spread = false
    for (let t = 0; t < 10; t++) {
      scatter = [
        (Math.random() - 0.5) * spreadX,
        (Math.random() - 0.5) * spreadY + (Math.random() - 0.3) * 2,
        (Math.random() - 0.5) * 7 - 1,
      ]
      if (Math.random() < zoneKeep(scatter[0], scatter[1])) { spread = true; break }
    }
    if (!spread) continue
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

function Particles({ map, normalMap, normalScale, geometry, data, spinBase, roughness }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const count = data.length
  const lastE = useRef(-1)   // dirty-check: последний записанный scroll-progress

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    data.forEach((d, i) => mesh.setColorAt(i, d.color))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    lastE.current = -1        // геометрия/данные сменились → форсируем перезапись матриц
  }, [data])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    const e = smooth(scrollProgress())          // прямая привязка к скроллу

    // DIRTY-CHECK: позиции/спин инстансов зависят ТОЛЬКО от e. Если скролл не
    // сдвинулся — 880 матриц идентичны прошлому кадру, не пересчитываем и НЕ
    // перезаливаем instanceMatrix на GPU (главная экономия в простое).
    if (Math.abs(e - lastE.current) > 1e-4) {
      lastE.current = e
      for (let i = 0; i < count; i++) {
        const d = data[i]
        dummy.position.set(
          d.scatter[0] + (d.heap[0] - d.scatter[0]) * e,
          d.scatter[1] + (d.heap[1] - d.scatter[1]) * e,
          d.scatter[2] + (d.heap[2] - d.scatter[2]) * e,
        )
        const spin = (1 - e) * spinBase          // рассыпанные крутятся, собранные — замирают
        dummy.rotation.set(d.rot[0] + spin, d.rot[1] + spin, d.rot[2])
        dummy.scale.setScalar(d.s)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    // медленное вращение собранной кучи — трансформ группы, а не инстансов
    // (дёшево, инстанс-буфер не трогает). Идёт только пока сцена видна:
    // при frameloop="never" useFrame не вызывается вовсе.
    if (!REDUCE) mesh.rotation.y += dt * 0.1 * e
  })

  return (
    <instancedMesh key={count} ref={ref} args={[geometry, undefined, count]}>
      {/* normalMap задан ВСЕГДА (заглушка FLAT_NORMAL до подъезда реальной Sobel-
          карты) — материал НЕ пересоздаётся по key: одна компиляция шейдера при
          первом рендере, дальше только подмена текстуры в слоте (тот же program,
          без второго long-task на перекомпиляцию). */}
      <meshStandardMaterial
        map={map}
        normalMap={normalMap || FLAT_NORMAL}
        normalScale={normalScale}
        roughness={roughness}
        metalness={0.05}
      />
    </instancedMesh>
  )
}

function Heap() {
  const [gravelMap, sandMap] = useLoader(THREE.TextureLoader, [
    '/textures/gravel.webp',
    '/textures/sand.webp',
  ])
  // цвет текстуры в sRGB, лёгкое повторение → на каждом камне читаемая фактура
  ;[gravelMap, sandMap].forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 2)
    t.anisotropy = 4
  })

  // рельеф из самих текстур → блики/тени по граням камней (не плоская наклейка).
  // Sobel по 512² ×2 текстуры (~0.5M итераций) — ТЯЖЁЛЫЙ синхронный расчёт.
  // Раньше шёл в useMemo прямо на маунте и блокировал первый paint/LCP. Теперь
  // откладываем на requestIdleCallback: сначала показываем сцену с плоским
  // альбедо, нормаль подъезжает в простое кадром позже (визуально — лёгкое
  // «проявление» рельефа, без джанка при загрузке страницы).
  const [normals, setNormals] = useState(null)
  useEffect(() => {
    if (!gravelMap?.image || !sandMap?.image) return
    let cancelled = false
    const id = ric(() => {
      if (cancelled) return
      setNormals({
        gravel: normalFromImage(gravelMap.image, 2.4),
        sand: normalFromImage(sandMap.image, 1.6),
      })
    })
    return () => { cancelled = true; cancelRic(id) }
  }, [gravelMap, sandMap])
  const gravelNormal = normals?.gravel || null
  const sandNormal   = normals?.sand || null

  const shadowBucket = useScrollBucket(24)
  const gravelNScale = useMemo(() => new THREE.Vector2(0.9, 0.9), [])
  const sandNScale   = useMemo(() => new THREE.Vector2(0.6, 0.6), [])

  const gravelGeo = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  const sandGeo   = useMemo(() => new THREE.IcosahedronGeometry(1, 0), [])

  // Разлёт по X привязан к АСПЕКТУ вьюпорта: на широком мониторе поле достаёт до
  // обоих краёв симметрично (камера в x=0, origin в x=0 — центрировано). Это
  // выравнивает РАСПРЕДЕЛЕНИЕ, а не количество: те же частицы расходятся шире.
  const spreadX = useMemo(() => {
    const aspect = (window.innerWidth || 1) / (window.innerHeight || 1)
    const halfW = Math.tan((44 * Math.PI / 180) / 2) * 7.6 * aspect  // полуширина кадра на z=0
    return Math.max(11, halfW * 2 * 1.15)                            // полная ширина, с запасом за край
  }, [])

  // гравий: крупные камни в конусе; песок: мелкие зёрна, шире и ниже (основание)
  // R — радиус основания, H — высота вершины. Варианты кучи см. в шапке файла.
  // ── КОМПАКТНАЯ (плотнее и выше) — активна ──
  const gravelData = useMemo(
    () => buildParticles(GRAVEL_COUNT, 2.1, 2.9, spreadX, 6, -0.95, 0.07, 0.13, 0.55),
    [spreadX],
  )
  const sandData = useMemo(
    () => buildParticles(SAND_COUNT, 2.7, 0.85, spreadX, 7, -1.05, 0.03, 0.055, 0.4),
    [spreadX],
  )
  // ── РАСКИДИСТАЯ (шире и ниже) — альтернатива ──
  //   gravel: buildParticles(GRAVEL_COUNT, 3.0, 2.2, 12, 6, -0.85, 0.07, 0.13, 0.55)
  //   sand:   buildParticles(SAND_COUNT, 3.6, 0.8, 13, 7, -1.0, 0.03, 0.055, 0.4)

  return (
    <>
      <Particles map={gravelMap} normalMap={gravelNormal} normalScale={gravelNScale}
                 geometry={gravelGeo}
                 data={gravelData} spinBase={1.4} roughness={0.7} />
      <Particles map={sandMap} normalMap={sandNormal} normalScale={sandNScale}
                 geometry={sandGeo}
                 data={sandData} spinBase={0.8} roughness={0.95} />
      <CalibrationCubes />
      {/* контактная тень: куча стоит на земле, а не висит. Тень концентрируется
          при сборке и расплывается при рассыпании — сама следует за частицами. */}
      {/* frames={1} — тень запекается ОДИН кадр, а не каждый (раньше Infinity =
          покадровый пересчёт shadow-map). Обновление по прогрессу через key:
          при смене бакета (≤24 шагов на весь скролл) компонент перемонтируется
          и перезапекается один раз — тень следует за кучей без per-frame цены. */}
      <ContactShadows
        key={shadowBucket}
        position={[0, -1.18, 0]}
        scale={9}
        blur={2.6}
        far={3.2}
        opacity={0.5}
        resolution={512}
        frames={1}
      />
    </>
  )
}

// КАЛИБРОВОЧНЫЕ КУБЫ. Отсылка к калибровочному кубу (правило 4×4): на каждой
// грани процедурная ч/б шахматка 4×4 (canvas → CanvasTexture, без внешних
// моделей). Крупнее гравия, медленно вращаются, участвуют в scroll-скрабе
// (scatter→heap), но расставлены ВНЕ text-safe zone.
function checkerTexture(cells = 4, px = 256) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const ctx = cv.getContext('2d')
  const s = px / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

const CUBE_COUNT = 7

function CalibrationCubes() {
  const ref = useRef()
  const map = useMemo(() => checkerTexture(4), [])
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // 7 кубов: осмысленно по кольцу вокруг кучи, мимо центра/safe-zone.
  // quat — текущая ориентация куба (аккумулирует вращение), инициализируется
  // стартовым rot; deltaQ (ось+скорость) домножается каждый кадр.
  const cubes = useMemo(() => {
    const out = []
    let guard = 0
    while (out.length < CUBE_COUNT && guard++ < 400) {
      const ang = Math.random() * Math.PI * 2
      const rr = 1.7 + Math.random() * 1.0            // ближе к краю основания
      const y = -0.75 + Math.random() * 1.7
      const heap = [Math.cos(ang) * rr, y, Math.sin(ang) * rr + 0.4]
      if (inZone(heap[0], heap[1])) continue

      let scatter
      for (let t = 0; t < 8; t++) {
        scatter = [(Math.random() - 0.5) * 11, (Math.random() - 0.5) * 6 + 1, (Math.random() - 0.5) * 6 - 1]
        if (!inZone(scatter[0], scatter[1])) break
      }
      if (inZone(scatter[0], scatter[1])) continue

      out.push({
        heap, scatter,
        s: 0.24 + Math.random() * 0.1,
        axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
        speed: 0.12 + Math.random() * 0.22,
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        ),
      })
    }
    return out
  }, [])

  const deltaQ = useMemo(() => new THREE.Quaternion(), [])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    const e = smooth(scrollProgress())
    // Кубы медленно вращаются каждый видимый кадр (их всего 7 → инстанс-буфер
    // дёшево переписать целиком, dirty-check не нужен). При frameloop="never"
    // useFrame не вызывается — вращение останавливается вместе со сценой.
    for (let i = 0; i < cubes.length; i++) {
      const cu = cubes[i]
      if (!REDUCE) {
        deltaQ.setFromAxisAngle(cu.axis, dt * cu.speed)
        cu.quat.multiply(deltaQ)
      }
      dummy.position.set(
        cu.scatter[0] + (cu.heap[0] - cu.scatter[0]) * e,
        cu.scatter[1] + (cu.heap[1] - cu.scatter[1]) * e,
        cu.scatter[2] + (cu.heap[2] - cu.scatter[2]) * e,
      )
      dummy.quaternion.copy(cu.quat)
      dummy.scale.setScalar(cu.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh key={cubes.length} ref={ref} args={[geo, undefined, cubes.length]}>
      <meshStandardMaterial map={map} roughness={0.55} metalness={0.05} />
    </instancedMesh>
  )
}

export default function CubesHeroImpl() {
  const wrapRef = useRef(null)
  const visibleRef = useRef(true)
  // frameloop канваса: "always" пока hero виден, "never" когда полностью ушёл за
  // скролл (opacity:0). При "never" r3f не рендерит и не зовёт useFrame вовсе —
  // сцена (и авто-вращение) замирает без ручных invalidate(). Позиции частиц
  // выводятся из scrollProgress() каждый кадр, поэтому при возврате в видимость
  // сцена продолжается с той же точки, без скачка/сброса.
  const [frameloop, setFrameloop] = useState('always')

  // канвас fixed во вьюпорте; гаснет после того, как куча собралась → не мешает
  // контенту ниже. При reduced-motion остаётся статичная собранная куча.
  useEffect(() => {
    if (REDUCE) return
    const onScroll = () => {
      const vh = window.innerHeight || 1
      // мягче: куча держится собранной дольше (старт позже, диапазон длиннее)
      const fade = 1 - Math.min(Math.max((window.scrollY - vh * 1.35) / (vh * 0.9), 0), 1)
      if (wrapRef.current) wrapRef.current.style.opacity = String(fade)
      // переключаем frameloop только на ГРАНИЦЕ видимости (не каждый скролл-тик)
      const vis = fade > 0
      if (vis !== visibleRef.current) {
        visibleRef.current = vis
        setFrameloop(vis ? 'always' : 'never')
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // reduced-motion: сцена статична (scrollProgress→1). Даём ей отрисоваться и
  // подгрузить normal-map, затем замораживаем — чтобы не гонять 60fps впустую.
  useEffect(() => {
    if (!REDUCE) return
    const t = setTimeout(() => setFrameloop('never'), 1500)
    return () => clearTimeout(t)
  }, [])

  // ОТЛОЖЕННЫЙ МАУНТ КАНВАСА. Форма загрузки — главное на странице, она должна
  // стать интерактивной сразу. Синхронный маунт Canvas тянет компиляцию PBR-
  // шейдеров в тот же кадр, что и первый paint формы → лаг входа. Ждём первый
  // paint (rAF) и простой (requestIdleCallback), затем монтируем сцену — компиляция
  // уходит с критического пути. .kb-hero3d-canvas делает плавный fade-in (CSS),
  // чтобы появление на кадр-два позже не выглядело резким.
  const [canvasMounted, setCanvasMounted] = useState(false)
  useEffect(() => {
    let id
    const raf = requestAnimationFrame(() => {
      id = ric(() => setCanvasMounted(true))
    })
    return () => { cancelAnimationFrame(raf); if (id != null) cancelRic(id) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-hero3d">
      {canvasMounted && (
      <div className="kb-hero3d-canvas">
      <Canvas
        frameloop={frameloop}
        dpr={[1, 1.5]}
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
      )}
      {/* скрим: мягкий радиальный vignette фонового цвета ПОВЕРХ канваса и ПОД
          текстом (см. CSS .hero-scrim) — заголовок всегда на чистом backdrop.
          Внутри wrapRef → гаснет вместе с канвасом при скролле. */}
      <div className="hero-scrim" />
      {/* плотная подложка под блоком заголовка (z над скримом, под глифами):
          растушёванный радиальный градиент var(--bg), без видимой плашки. */}
      <div className="hero-title-glow" />
    </div>
  )
}
