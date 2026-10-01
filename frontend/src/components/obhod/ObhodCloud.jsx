import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { buildSurface } from './surface'

/* 3D-вид обхода: облако точек кучи, крутится само, тянется мышью/пальцем.

   Источник — одно из двух:
   • src: бинарник KSPC (плотное облако реконструкции, уже нормировано:
     земля y=0, радиус подошвы ≈ 1). Формат — frontend/scripts/cloud_asset.py:
     'KSPC', uint32 count, float32 lim, float32 height, int16[3]·count, uint8[3]·count.
   • data: { points: [[x,y,z]…], cameras?: [[x,y,z]…] } — разреженные точки ARKit
     (метры, y вверх по гравитации) и позиции камеры на кадрах. Нормируем здесь.

   three.js грузится динамически — только когда открыли вкладку 3D. */

async function loadKSPC(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('cloud ' + res.status)
  const buf = await res.arrayBuffer()
  const dv = new DataView(buf)
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
  if (magic !== 'KSPC') throw new Error('bad cloud')
  const n = dv.getUint32(4, true), lim = dv.getFloat32(8, true), height = dv.getFloat32(12, true)
  const q = new Int16Array(buf, 16, n * 3)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) positions[i] = (q[i] / 32767) * lim
  const colors = new Uint8Array(buf, 16 + n * 6, n * 3)
  return { positions, colors, height, count: n, cameras: null }
}

function normalizeArkit({ points, cameras }) {
  const n = points.length
  // поверхность, земля и область кучи (метры); см. surface.js
  const surf = buildSurface(points, cameras || [])
  let cx, cz, r
  if (surf) {
    // центр и масштаб — по петле обхода, а не по всем точкам: фон (деревья,
    // стены) далеко за петлёй иначе раздувает масштаб и куча становится крошкой
    ;[cx, cz] = surf.center; r = surf.R || 1
  } else {
    const xs = points.map((p) => p[0]).sort((a, b) => a - b)
    const zs = points.map((p) => p[2]).sort((a, b) => a - b)
    cx = xs[n >> 1]; cz = zs[n >> 1]
    r = points.map((p) => Math.hypot(p[0] - cx, p[2] - cz)).sort((a, b) => a - b)[Math.floor(n * 0.95)] || 1
  }
  const pl = surf?.plane || { a: 0, b: 0, c: points.map((p) => p[1]).sort((a, b) => a - b)[Math.floor(n * 0.04)] }
  const ground = (x, z) => pl.a * x + pl.b * z + pl.c
  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 3)
  const roi = new Float32Array(n).fill(1)
  points.forEach((p, i) => {
    positions[i * 3] = (p[0] - cx) / r; positions[i * 3 + 1] = (p[1] - ground(p[0], p[2])) / r; positions[i * 3 + 2] = (p[2] - cz) / r
    if (surf) roi[i] = surf.inRoi[i]
  })
  // высота для цвета/анимации — по куче, а не по самой высокой точке фона
  let top = 0
  if (surf?.top) top = surf.top / r
  else for (let i = 1; i < n * 3; i += 3) top = Math.max(top, positions[i])
  // цвет по высоте: ARKit не даёт цвет точек — раскрашиваем от земли к вершине
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, Math.max(0, positions[i * 3 + 1] / (top || 1)))
    colors[i * 3] = 120 + h * 90; colors[i * 3 + 1] = 150 + h * 80; colors[i * 3 + 2] = 110 + h * 40
  }
  const cams = cameras?.length ? cameras.map((c) => [(c[0] - cx) / r, (c[1] - ground(c[0], c[2])) / r, (c[2] - cz) / r]) : null
  // сетка поверхности в тех же нормированных координатах, что и точки
  const surface = surf && surf.top > 0 ? {
    nx: surf.nx, nz: surf.nz, step: surf.cell / r, x0: (surf.x0 - cx) / r, z0: (surf.z0 - cz) / r,
    h: surf.h.map((v) => v / r), mask: surf.mask, scale: r,
    hull: surf.hull.map(([x, z]) => [(x - cx) / r, (z - cz) / r]),
    volume: surf.volume, range: surf.volumeRange, area: surf.area, top: surf.top, size: surf.size,
    closed: surf.closed, groundSource: surf.plane.source, hold: surf.plane.hold, foot: surf.foot,
  } : null
  return { positions, colors, roi, height: top || 0.4, count: n, cameras: cams, surface }
}

/* Сетка высот → треугольники. Клетки вне маски (там нет данных) не рисуем,
   поэтому край поверхности повторяет форму обхода, а не квадрат. */
function surfaceMesh(THREE, S, dark) {
  const { nx, nz, step, x0, z0, h, mask } = S
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3)
  let top = 0
  for (const v of h) if (v > top) top = v
  const low = new THREE.Color(dark ? '#5d6b52' : '#a9b394'), mid = new THREE.Color(dark ? '#b9a98a' : '#cdbf9f'), hi = new THREE.Color(dark ? '#f1e6cc' : '#f5ecd6')
  const c = new THREE.Color()
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const k = iz * nx + ix, y = h[k]
    pos[k * 3] = x0 + ix * step; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z0 + iz * step
    const t = top ? y / top : 0
    if (y <= 0) c.copy(low); else if (t < 0.35) c.copy(low).lerp(mid, t / 0.35); else c.copy(mid).lerp(hi, (t - 0.35) / 0.65)
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b
  }
  const idx = []
  for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
    const a = iz * nx + ix, b = a + 1, d = a + nx, e = d + 1
    if (!(mask[a] && mask[b] && mask[d] && mask[e])) continue
    idx.push(a, d, b, b, d, e)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* Земля внутри петли обхода: ровный многоугольник под сеткой, чтобы край
   был гладким, а не лесенкой из клеток. */
function groundPatch(THREE, S, dark) {
  const n = S.hull.length
  const mx = S.hull.reduce((s, p) => s + p[0], 0) / n, mz = S.hull.reduce((s, p) => s + p[1], 0) / n
  const pad = S.step * 2
  const shape = new THREE.Shape(S.hull.map(([x, z]) => {
    const d = Math.hypot(x - mx, z - mz) || 1
    return new THREE.Vector2(x + ((x - mx) / d) * pad, -(z + ((z - mz) / d) * pad))
  }))
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: dark ? '#5d6b52' : '#a9b394', roughness: 1 }))
  m.rotation.x = -Math.PI / 2; m.position.y = -0.002
  return m
}

/* Человек 1,75 м у начала обхода — сразу видно масштаб кучи. */
function personFigure(THREE, scale, at, dark) {
  const s = 1 / scale, grp = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: dark ? '#3c4a40' : '#4b5a4f', roughness: 0.8 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 1.5 * s, 20), mat)
  body.position.y = 0.75 * s
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 20, 14), mat)
  head.position.y = 1.62 * s
  grp.add(body, head)
  grp.position.set(at[0], 0, at[2])
  return grp
}

const VERT = /* glsl */`
  attribute vec3 aColor; attribute float aRoi;
  uniform float uSize, uProgress, uHeight, uPixelRatio, uSweep;
  varying vec3 vColor; varying float vBand; varying float vShow; varying float vH; varying float vRoi;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float h = position.y / uHeight;
    float cut = uProgress * 1.2 - 0.08;
    vShow = step(h, cut);
    vBand = smoothstep(0.07, 0.0, abs(h - cut)) * (1.0 - step(1.0, uProgress));
    // витрина: после появления по куче снизу вверх бежит полоса сканирования
    if (uSweep >= 0.0) vBand = max(vBand, smoothstep(0.045, 0.0, abs(h - uSweep)) * 0.85);
    vColor = aColor; vH = h; vRoi = aRoi;
    gl_PointSize = uSize * uPixelRatio / -mv.z;
  }`
const FRAG = /* glsl */`
  uniform vec3 uAccent, uTint; uniform float uIso, uGain, uTintAmt, uMinH, uRoiOnly;
  varying vec3 vColor; varying float vBand; varying float vShow; varying float vH; varying float vRoi;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
    if (r > 0.25 || vShow < 0.5 || vH < uMinH || (uRoiOnly > 0.5 && vRoi < 0.5)) discard;
    vec3 col = mix(vColor * uGain, uTint, uTintAmt);
    // горизонтали, как на топоплане: тонкие линии через равные высоты
    float f = fract(vH * 9.0); float iso = 1.0 - smoothstep(0.0, 0.05, min(f, 1.0 - f));
    col = mix(col, uAccent, iso * uIso * step(0.04, vH));
    col = mix(col, uAccent, vBand * 0.9);
    gl_FragColor = vec4(col * (1.0 - r * 0.9), 1.0);
  }`

const fmtM = (v, d = 1) => v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })
// объём: крупный — целыми (± десятки м³ всё равно не различить), мелкий — с долями
const fmtVol = (v) => fmtM(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)

export default function ObhodCloud({ src, data, theme = 'light', onReady, variant = 'map', paused = false }) {
  const hero = variant === 'hero'
  const pausedRef = useRef(paused)
  const kickRef = useRef(null)
  useEffect(() => { pausedRef.current = paused; if (!paused) kickRef.current?.() }, [paused])
  const host = useRef(null)
  const [status, setStatus] = useState('loading')
  const [touched, setTouched] = useState(false)
  const [surf, setSurf] = useState(null)        // { volume, area, top } — есть поверхность
  const [view, setView] = useState('surface')   // 'surface' | 'points'
  const viewRef = useRef(view)
  const applyViewRef = useRef(null)
  useEffect(() => { viewRef.current = view; applyViewRef.current?.() }, [view])
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = host.current
    if (!el || (!src && !data)) return
    let disposed = false, raf = 0
    const cleanup = []
    setStatus('loading'); setSurf(null)

    ;(async () => {
      const THREE = await import('three')
      const cloud = src ? await loadKSPC(src) : normalizeArkit(data)
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(dpr)
      renderer.setClearColor(0x000000, 0)
      el.appendChild(renderer.domElement)
      cleanup.push(() => { renderer.dispose(); renderer.domElement.remove() })

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(hero ? 24 : 30, 1, 0.05, 60)
      const dark = theme === 'dark'
      const accent = new THREE.Color(dark ? '#8fd46a' : '#5f8f45')

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
      geo.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors, 3, true))
      geo.setAttribute('aRoi', new THREE.BufferAttribute(cloud.roi || new Float32Array(cloud.count).fill(1), 1))
      const sparse = cloud.count < 20000
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uSize: { value: sparse ? 24 : hero ? 10.5 : 12.5 }, uProgress: { value: reduce ? 1.2 : 0 },
          uHeight: { value: cloud.height || 0.4 }, uPixelRatio: { value: dpr }, uAccent: { value: accent },
          uSweep: { value: -1 }, uTint: { value: new THREE.Color(dark ? '#e8c25a' : '#d6a536') }, uTintAmt: { value: 0 }, uMinH: { value: -1e3 }, uRoiOnly: { value: 0 }, uIso: { value: hero ? (dark ? .55 : .4) : 0 }, uGain: { value: hero && dark ? 1.18 : 1 },
        },
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      cleanup.push(() => { geo.dispose(); mat.dispose() })

      // поверхность по точкам VIO (только для ARKit: у плотного облака своя форма)
      let mesh = null, person = null, patch = null
      if (cloud.surface && !hero) {
        const sg = surfaceMesh(THREE, cloud.surface, dark)
        mesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }))
        mesh.scale.y = reduce ? 1 : 0.001
        scene.add(mesh)
        patch = groundPatch(THREE, cloud.surface, dark)
        scene.add(patch)
        cleanup.push(() => { patch.geometry.dispose(); patch.material.dispose() })
        const hemi = new THREE.HemisphereLight(dark ? '#cfd8e6' : '#fffaf0', dark ? '#141810' : '#55503f', dark ? 0.7 : 0.9)
        const sun = new THREE.DirectionalLight('#fff1d6', dark ? 2.4 : 2.6); sun.position.set(1.6, 2.2, 2.4)
        scene.add(hemi, sun)
        cleanup.push(() => { sg.dispose(); mesh.material.dispose() })
        // человек — только рядом с крупным объектом: у стола он заслонит всё
        if (cloud.cameras?.length && cloud.surface.scale >= 2) {
          person = personFigure(THREE, cloud.surface.scale, cloud.cameras[0], dark)
          scene.add(person)
          cleanup.push(() => person.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() }))
        }
        const S = cloud.surface
        setSurf({ volume: S.volume, range: S.range, area: S.area, top: S.top, size: S.size, closed: S.closed, groundSource: S.groundSource, foot: S.foot })
      }
      // точки поверх поверхности — мельче и золотом, как на скриншоте анализа
      const baseSize = mat.uniforms.uSize.value
      applyViewRef.current = () => {
        const on = !!mesh && viewRef.current === 'surface'
        if (mesh) mesh.visible = on
        if (person) person.visible = on
        if (patch) patch.visible = on
        mat.uniforms.uSize.value = on ? baseSize * 0.32 : baseSize
        // на поверхности: точки земли прячем, остальные — мелкое золото
        mat.uniforms.uTintAmt.value = on ? 1 : 0
        mat.uniforms.uMinH.value = on ? 0.06 : -1e3
        mat.uniforms.uRoiOnly.value = on ? 1 : 0   // фон за петлёй обхода — только в режиме «Точки»
        mat.uniforms.uSweep.value = -1
        if (!raf && !disposed) kickRef.current?.()
      }
      applyViewRef.current()
      cleanup.push(() => { applyViewRef.current = null })

      // земля: кольца-засечки как у геодезической разметки + мягкая тень
      const lineCol = new THREE.Color(dark ? '#3a3d38' : '#cfc8b8')
      const grid = new THREE.PolarGridHelper(hero ? 1.5 : 1.55, hero ? 24 : 12, hero ? 5 : 5, 128, lineCol, lineCol)
      grid.material.transparent = true; grid.material.opacity = dark ? (hero ? .7 : .55) : 0.8
      grid.position.y = -0.025
      scene.add(grid)
      cleanup.push(() => { grid.geometry.dispose(); grid.material.dispose() })

      const shCanvas = document.createElement('canvas'); shCanvas.width = shCanvas.height = 128
      const g2 = shCanvas.getContext('2d')
      const grad = g2.createRadialGradient(64, 64, 8, 64, 64, 64)
      grad.addColorStop(0, dark ? 'rgba(0,0,0,.55)' : 'rgba(70,60,40,.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)')
      g2.fillStyle = grad; g2.fillRect(0, 0, 128, 128)
      const shTex = new THREE.CanvasTexture(shCanvas)
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }))
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.006
      scene.add(shadow)
      cleanup.push(() => { shTex.dispose(); shadow.geometry.dispose(); shadow.material.dispose() })

      // позиции камеры на кадрах (для ARKit): линия обхода + точки
      if (cloud.cameras) {
        const cg = new THREE.BufferGeometry().setFromPoints(cloud.cameras.map((c) => new THREE.Vector3(c[0], c[1], c[2])))
        const line = new THREE.Line(cg, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.8 }))
        const dots = new THREE.Points(cg, new THREE.PointsMaterial({ color: accent, size: 5, sizeAttenuation: false }))
        scene.add(line, dots)
        cleanup.push(() => { cg.dispose(); line.material.dispose(); dots.material.dispose() })
      }

      // орбита: азимут крутится сам, тянется указателем; наклон ограничен
      const H = cloud.height || 0.4
      const target = new THREE.Vector3(0, H * (hero ? 0.12 : 0.32), 0)
      let theta = 0.6, phi = hero ? 0.5 : 0.42, vel = 0, lastInput = -1e9, dragging = false, px = 0, py = 0
      // объект выше петли обхода (стол, обход вплотную) — отходим дальше
      const radius = (cloud.cameras ? 4.9 : hero ? 4.5 : 4.3) * Math.max(1, (H + 0.3) / 0.75)
      let zoom = mesh && viewRef.current === 'surface' ? 0.72 : 1
      // витрина: наклон к курсору (как будто куча поворачивается к взгляду)
      const tilt = { x: 0, y: 0, tx: 0, ty: 0 }
      const place = () => {
        const th = theta + tilt.x * 0.45, ph = Math.min(1.2, Math.max(0.1, phi + tilt.y * 0.12))
        // на поверхности подходим ближе: куча, а не весь обход, в центре кадра
        zoom += ((mesh && viewRef.current === 'surface' ? 0.72 : 1) - zoom) * 0.12
        const R = radius * zoom
        camera.position.set(target.x + R * Math.cos(ph) * Math.sin(th), target.y + R * Math.sin(ph), target.z + R * Math.cos(ph) * Math.cos(th))
        camera.lookAt(target)
      }
      if (hero) {
        const onTilt = (e) => {
          const r = el.getBoundingClientRect()
          tilt.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
          tilt.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
        }
        window.addEventListener('pointermove', onTilt, { passive: true })
        cleanup.push(() => window.removeEventListener('pointermove', onTilt))
      }
      const cv = renderer.domElement
      cv.style.touchAction = 'pan-y'
      const down = (e) => { dragging = true; px = e.clientX; py = e.clientY; vel = 0; cv.setPointerCapture?.(e.pointerId); setTouched(true) }
      const move = (e) => {
        if (!dragging) return
        const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY
        theta -= dx * 0.009; vel = -dx * 0.009
        phi = Math.min(1.2, Math.max(0.12, phi + dy * 0.006))
        lastInput = performance.now()
      }
      const up = () => { dragging = false; lastInput = performance.now() }
      const dbl = () => { theta = 0.6; phi = 0.42; vel = 0 }
      cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move)
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('dblclick', dbl)
      cleanup.push(() => { cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('dblclick', dbl) })

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h, false); cv.style.width = w + 'px'; cv.style.height = h + 'px'
        camera.aspect = w / h; camera.updateProjectionMatrix()
      }
      const ro = new ResizeObserver(resize); ro.observe(el); resize()
      cleanup.push(() => ro.disconnect())

      let visible = true
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !raf) loop(performance.now()) })
      io.observe(el)
      cleanup.push(() => io.disconnect())

      const t0 = performance.now()
      let prev = t0
      function loop(now) {
        raf = 0
        if (disposed || !visible || document.hidden || pausedRef.current) return
        const dt = Math.min(0.05, (now - prev) / 1000); prev = now
        if (!reduce) mat.uniforms.uProgress.value = Math.min(1.2, (now - t0) / (hero ? 2400 : 1700))
        if (mesh && !reduce && mesh.scale.y < 1) {
          const t = Math.min(1, Math.max(0, ((now - t0) - 900) / 1100))
          mesh.scale.y = Math.max(0.001, 1 - Math.pow(1 - t, 3))
        }
        if (hero && !reduce) {
          const since = (now - t0) / 1000 - 2.6
          mat.uniforms.uSweep.value = since > 0 ? (since % 4.2) / 3.6 - 0.05 : -1
          tilt.x += (tilt.tx - tilt.x) * Math.min(1, dt * 5); tilt.y += (tilt.ty - tilt.y) * Math.min(1, dt * 5)
        }
        if (!dragging) {
          if (Math.abs(vel) > 1e-4) { theta += vel; vel *= 0.92 }
          else if (!reduce && now - lastInput > 2600) theta += dt * 0.16
        }
        place()
        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      const onVis = () => { if (!document.hidden && !raf) { prev = performance.now(); loop(prev) } }
      kickRef.current = () => { if (!raf && !disposed) { prev = performance.now(); raf = requestAnimationFrame(loop) } }
      document.addEventListener('visibilitychange', onVis)
      cleanup.push(() => document.removeEventListener('visibilitychange', onVis))

      place(); renderer.render(scene, camera)
      setStatus('ready'); onReady?.(cloud)
      raf = requestAnimationFrame(loop)
    })().catch(() => { if (!disposed) setStatus('error') })

    return () => { disposed = true; if (raf) cancelAnimationFrame(raf); cleanup.reverse().forEach((f) => f()) }
  }, [src, data, theme, reduce, hero])

  return (
    <div className="ks-cloud">
      <div className="ks-cloud__gl" ref={host} />
      {status === 'loading' && !hero && <div className="ks-cloud__msg"><span className="ks-cloud__spin" />Загружаем облако точек…</div>}
      {status === 'error' && !hero && <div className="ks-cloud__msg">Облако не загрузилось. Попробуйте позже.</div>}
      {status === 'ready' && !hero && <div className={'ks-cloud__hint' + (touched ? ' is-gone' : '')}>↻ Потяните, чтобы повернуть</div>}
      {status === 'ready' && surf && (
        <div className="ks-cloud__surf">
          <div className="ks-cloud__seg" role="group" aria-label="Вид модели">
            <button type="button" className={view === 'surface' ? 'is-on' : ''} aria-pressed={view === 'surface'} onClick={() => setView('surface')}>Поверхность</button>
            <button type="button" className={view === 'points' ? 'is-on' : ''} aria-pressed={view === 'points'} onClick={() => setView('points')}>Точки</button>
          </div>
          {view === 'surface' && (
            <div className="ks-cloud__vol" title="Предварительно: по разреженным точкам ARKit, без реконструкции. Диапазон — от неточности уровня земли.">
              <b>≈ {fmtVol(surf.volume)} м³</b>
              <span>диапазон {fmtVol(surf.range[0])}–{fmtVol(surf.range[1])} м³</span>
              {surf.foot && <span className="is-warn">у подошвы слой {fmtM(surf.foot.lift * 100, 0)} см: если это земля — ≈ {fmtVol(surf.foot.volume)} м³</span>}
              <span>высота {fmtM(surf.top, 1)} м · подошва ≈{fmtM(surf.size[0], 0)}×{fmtM(surf.size[1], 0)} м</span>
              {!surf.closed && <span className="is-warn">обход не замкнут — объём ненадёжен</span>}
              {surf.closed && surf.groundSource !== 'path' && <span className="is-warn">земля найдена по точкам, не по траектории</span>}
              <span>по точкам VIO, предварительно</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
