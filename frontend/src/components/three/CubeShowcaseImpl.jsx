import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* ════════════════════════════════════════════════════════════════════════
   ЛЕНДИНГ · «поле калибровочных кубов». Много шахматных кубов (отсылка к
   калибровочному кубу 4×4, как в hero основного сайта) рассыпаны и СОБИРАЮТСЯ
   в пирамиду по мере въезда секции в кадр + постоянно кувыркаются. Кремовый
   фон, охра/лес по подсветке. Self-contained: прогресс берём из позиции
   собственной секции (не из window-top), поэтому работает в любом месте
   страницы. Перф по CLAUDE.md: гейт frameloop по видимости (IntersectionObserver),
   dirty-check не нужен (кубов немного → буфер дёшев), dpr[1,1.5], отложенный маунт.
   ════════════════════════════════════════════════════════════════════════ */

const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const smooth = (t) => t * t * (3 - 2 * t)
const clamp01 = (v) => Math.min(Math.max(v, 0), 1)

const ric = (fn) =>
  (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(fn, { timeout: 1200 })
    : setTimeout(fn, 200)
const cancelRic = (id) =>
  (typeof window !== 'undefined' && window.cancelIdleCallback)
    ? window.cancelIdleCallback(id)
    : clearTimeout(id)

// процедурная шахматка 4×4 → CanvasTexture (без внешних ассетов)
function checkerTexture(cells = 4, px = 256) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = px
  const ctx = cv.getContext('2d')
  const s = px / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#141414' : '#f3efe6'
      ctx.fillRect(x * s, y * s, s, s)
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

const CUBE_COUNT = 34

// пирамида кубов: слои снизу вверх (уменьшающаяся сетка) + лёгкий джиттер
function buildHeap() {
  const out = []
  const layers = [
    { n: 3, y: -1.15, step: 1.02 },
    { n: 3, y: -0.15, step: 1.02 },
    { n: 2, y: 0.85, step: 1.05 },
    { n: 1, y: 1.7, step: 1.0 },
  ]
  for (const L of layers) {
    const off = ((L.n - 1) * L.step) / 2
    for (let ix = 0; ix < L.n; ix++) {
      for (let iz = 0; iz < L.n; iz++) {
        out.push([
          ix * L.step - off + (Math.random() - 0.5) * 0.12,
          L.y + (Math.random() - 0.5) * 0.08,
          iz * L.step - off + (Math.random() - 0.5) * 0.12,
        ])
        if (out.length >= CUBE_COUNT) return out
      }
    }
  }
  return out
}

function Cubes({ progressRef }) {
  const ref = useRef()
  const map = useMemo(() => checkerTexture(4), [])
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const deltaQ = useMemo(() => new THREE.Quaternion(), [])

  const cubes = useMemo(() => {
    const heaps = buildHeap()
    return heaps.map((heap) => ({
      heap,
      scatter: [
        (Math.random() - 0.5) * 11,
        (Math.random() - 0.5) * 7 + 1,
        (Math.random() - 0.5) * 6 - 1,
      ],
      s: 0.62 + Math.random() * 0.5,
      axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
      speed: 0.15 + Math.random() * 0.3,
      quat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
      ),
    }))
  }, [])

  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    const e = smooth(progressRef.current)
    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i]
      if (!REDUCE) {
        deltaQ.setFromAxisAngle(c.axis, dt * c.speed * (1.1 - e * 0.7))
        c.quat.multiply(deltaQ)
      }
      dummy.position.set(
        c.scatter[0] + (c.heap[0] - c.scatter[0]) * e,
        c.scatter[1] + (c.heap[1] - c.scatter[1]) * e,
        c.scatter[2] + (c.heap[2] - c.scatter[2]) * e,
      )
      dummy.quaternion.copy(c.quat)
      dummy.scale.setScalar(c.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[geo, undefined, cubes.length]}>
      <meshStandardMaterial map={map} roughness={0.5} metalness={0.05} />
    </instancedMesh>
  )
}

export default function CubeShowcaseImpl() {
  const wrapRef = useRef(null)
  const progressRef = useRef(REDUCE ? 1 : 0)
  const [frameloop, setFrameloop] = useState('never')
  const [mounted, setMounted] = useState(false)

  // прогресс из позиции секции: 0 когда секция снизу, 1 когда прокрутили сквозь
  useEffect(() => {
    if (REDUCE) { progressRef.current = 1; return }
    const onScroll = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const vh = window.innerHeight || 1
      progressRef.current = clamp01((vh * 0.82 - r.top) / (vh * 0.75))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // гейт рендера по видимости секции
  useEffect(() => {
    if (!wrapRef.current) return
    const io = new IntersectionObserver(
      ([e]) => setFrameloop(e.isIntersecting ? 'always' : 'never'),
      { rootMargin: '10% 0px' },
    )
    io.observe(wrapRef.current)
    return () => io.disconnect()
  }, [mounted])

  // отложенный маунт
  useEffect(() => {
    let id
    const raf = requestAnimationFrame(() => { id = ric(() => setMounted(true)) })
    return () => { cancelAnimationFrame(raf); if (id != null) cancelRic(id) }
  }, [])

  return (
    <div ref={wrapRef} className="kb-l-cubes">
      {mounted && (
        <Canvas
          frameloop={REDUCE ? 'demand' : frameloop}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 0.8, 8], fov: 42 }}
          style={{ pointerEvents: 'none' }}
        >
          <ambientLight intensity={0.85} />
          <directionalLight position={[5, 8, 5]} intensity={1.5} />
          <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#c98a24" />
          <Cubes progressRef={progressRef} />
        </Canvas>
      )}
    </div>
  )
}
