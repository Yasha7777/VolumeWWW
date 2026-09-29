import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

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
  const xs = points.map((p) => p[0]).sort((a, b) => a - b)
  const zs = points.map((p) => p[2]).sort((a, b) => a - b)
  const ys = points.map((p) => p[1]).sort((a, b) => a - b)
  const cx = xs[n >> 1], cz = zs[n >> 1], y0 = ys[Math.floor(n * 0.04)]
  const r = points.map((p) => Math.hypot(p[0] - cx, p[2] - cz)).sort((a, b) => a - b)[Math.floor(n * 0.95)] || 1
  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 3)
  points.forEach((p, i) => {
    positions[i * 3] = (p[0] - cx) / r; positions[i * 3 + 1] = (p[1] - y0) / r; positions[i * 3 + 2] = (p[2] - cz) / r
  })
  let top = 0
  for (let i = 1; i < n * 3; i += 3) top = Math.max(top, positions[i])
  // цвет по высоте: ARKit не даёт цвет точек — раскрашиваем от земли к вершине
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, Math.max(0, positions[i * 3 + 1] / (top || 1)))
    colors[i * 3] = 120 + h * 90; colors[i * 3 + 1] = 150 + h * 80; colors[i * 3 + 2] = 110 + h * 40
  }
  const cams = cameras?.length ? cameras.map((c) => [(c[0] - cx) / r, (c[1] - y0) / r, (c[2] - cz) / r]) : null
  return { positions, colors, height: top || 0.4, count: n, cameras: cams }
}

const VERT = /* glsl */`
  attribute vec3 aColor;
  uniform float uSize, uProgress, uHeight, uPixelRatio;
  varying vec3 vColor; varying float vBand; varying float vShow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float h = position.y / uHeight;
    float cut = uProgress * 1.2 - 0.08;
    vShow = step(h, cut);
    vBand = smoothstep(0.07, 0.0, abs(h - cut)) * (1.0 - step(1.0, uProgress));
    vColor = aColor;
    gl_PointSize = uSize * uPixelRatio / -mv.z;
  }`
const FRAG = /* glsl */`
  uniform vec3 uAccent;
  varying vec3 vColor; varying float vBand; varying float vShow;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
    if (r > 0.25 || vShow < 0.5) discard;
    vec3 col = mix(vColor, uAccent, vBand * 0.9);
    gl_FragColor = vec4(col * (1.0 - r * 0.9), 1.0);
  }`

export default function ObhodCloud({ src, data, theme = 'light', onReady }) {
  const host = useRef(null)
  const [status, setStatus] = useState('loading')
  const [touched, setTouched] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = host.current
    if (!el || (!src && !data)) return
    let disposed = false, raf = 0
    const cleanup = []
    setStatus('loading')

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
      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60)
      const dark = theme === 'dark'
      const accent = new THREE.Color(dark ? '#8fd46a' : '#5f8f45')

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
      geo.setAttribute('aColor', new THREE.BufferAttribute(cloud.colors, 3, true))
      const sparse = cloud.count < 20000
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
          uSize: { value: sparse ? 24 : 12.5 }, uProgress: { value: reduce ? 1.2 : 0 },
          uHeight: { value: cloud.height || 0.4 }, uPixelRatio: { value: dpr }, uAccent: { value: accent },
        },
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      cleanup.push(() => { geo.dispose(); mat.dispose() })

      // земля: кольца-засечки как у геодезической разметки + мягкая тень
      const lineCol = new THREE.Color(dark ? '#3a3d38' : '#cfc8b8')
      const grid = new THREE.PolarGridHelper(1.55, 12, 5, 96, lineCol, lineCol)
      grid.material.transparent = true; grid.material.opacity = dark ? 0.55 : 0.8
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
      const target = new THREE.Vector3(0, H * 0.32, 0)
      let theta = 0.6, phi = 0.42, vel = 0, lastInput = -1e9, dragging = false, px = 0, py = 0
      const radius = cloud.cameras ? 4.9 : 4.3
      const place = () => {
        camera.position.set(target.x + radius * Math.cos(phi) * Math.sin(theta), target.y + radius * Math.sin(phi), target.z + radius * Math.cos(phi) * Math.cos(theta))
        camera.lookAt(target)
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
        if (disposed || !visible || document.hidden) return
        const dt = Math.min(0.05, (now - prev) / 1000); prev = now
        if (!reduce) mat.uniforms.uProgress.value = Math.min(1.2, (now - t0) / 1700)
        if (!dragging) {
          if (Math.abs(vel) > 1e-4) { theta += vel; vel *= 0.92 }
          else if (!reduce && now - lastInput > 2600) theta += dt * 0.16
        }
        place()
        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      const onVis = () => { if (!document.hidden && !raf) { prev = performance.now(); loop(prev) } }
      document.addEventListener('visibilitychange', onVis)
      cleanup.push(() => document.removeEventListener('visibilitychange', onVis))

      place(); renderer.render(scene, camera)
      setStatus('ready'); onReady?.(cloud)
      raf = requestAnimationFrame(loop)
    })().catch(() => { if (!disposed) setStatus('error') })

    return () => { disposed = true; if (raf) cancelAnimationFrame(raf); cleanup.reverse().forEach((f) => f()) }
  }, [src, data, theme, reduce])

  return (
    <div className="ks-cloud">
      <div className="ks-cloud__gl" ref={host} />
      {status === 'loading' && <div className="ks-cloud__msg"><span className="ks-cloud__spin" />Загружаем облако точек…</div>}
      {status === 'error' && <div className="ks-cloud__msg">Облако не загрузилось. Попробуйте позже.</div>}
      {status === 'ready' && <div className={'ks-cloud__hint' + (touched ? ' is-gone' : '')}>↻ Потяните, чтобы повернуть</div>}
    </div>
  )
}
