import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// «Фото → объём»: облако точек, рассыпанное вверху страницы, СОБИРАЕТСЯ в кучу
// щебня по мере прокрутки, а вся масса медленно вращается. Чистый three.js
// (без r3f-обёртки) — легче для фонового героя. Ленивая загрузка + очистка.
//
// Палитра карельская: охра-золото на вершине → лес у основания.
const COUNT = 4200
const R = 2.15          // радиус основания кучи
const H = 2.05          // высота вершины
const EASE = (t) => t * t * (3 - 2 * t)   // smoothstep

export default function PointCloudHeroImpl() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const w = () => mount.clientWidth || 1
    const h = () => mount.clientHeight || 1

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, w() / h(), 0.1, 100)
    camera.position.set(0, 1.15, 6.4)
    camera.lookAt(0, 0.5, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setSize(w(), h())
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    // круглый мягкий спрайт: без него three рисует точки КВАДРАТАМИ
    const sprite = (() => {
      const s = 64
      const cv = document.createElement('canvas')
      cv.width = cv.height = s
      const c = cv.getContext('2d')
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.85)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, s, s)
      const t = new THREE.CanvasTexture(cv)
      t.needsUpdate = true
      return t
    })()

    // ── позиции: рассыпано (сфера) → собрано (конус-куча) ──
    const scattered = new Float32Array(COUNT * 3)
    const assembled = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)

    const gold = new THREE.Color('#c98a24')
    const green = new THREE.Color('#2f4a1c')
    const tmp = new THREE.Color()

    for (let i = 0; i < COUNT; i++) {
      // собранное: равномерный диск по радиусу, высота падает к краю (куча)
      const ang = Math.random() * Math.PI * 2
      const rr = Math.sqrt(Math.random()) * R
      const maxY = H * (1 - rr / R)
      const y = Math.random() * maxY
      const ax = Math.cos(ang) * rr
      const az = Math.sin(ang) * rr
      assembled[i * 3] = ax
      assembled[i * 3 + 1] = y - 0.9        // опускаем, чтобы куча стояла по центру
      assembled[i * 3 + 2] = az

      // рассыпанное: облако в большой сфере вокруг
      const u = Math.random(), v = Math.random()
      const theta = u * Math.PI * 2
      const phi = Math.acos(2 * v - 1)
      const rad = 3.4 + Math.random() * 2.6
      scattered[i * 3] = Math.sin(phi) * Math.cos(theta) * rad
      scattered[i * 3 + 1] = Math.cos(phi) * rad * 0.7
      scattered[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * rad

      // цвет по нормированной высоте кучи: золото сверху → лес у земли
      const tcol = maxY > 0 ? y / H : 0
      tmp.copy(green).lerp(gold, EASE(Math.min(tcol * 1.6, 1)))
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }

    const geo = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(new Float32Array(scattered), 3)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const mat = new THREE.PointsMaterial({
      size: 0.05,
      map: sprite,
      alphaTest: 0.02,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const points = new THREE.Points(geo, mat)

    // bloom-подобное свечение: второй слой крупных точек с аддитивным блендингом
    // (тот же geo → двигается синхронно). Безопасно для прозрачного фона.
    const glowMat = new THREE.PointsMaterial({
      size: 0.16,
      map: sprite,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Points(geo, glowMat)

    const group = new THREE.Group()
    group.add(glow)
    group.add(points)
    scene.add(group)

    // Сборка кучи — разовая интро-анимация при появлении (всегда видимая,
    // без завязки на прокрутку). reduced-motion → сразу собрано.
    const INTRO_MS = 2400
    const t0 = performance.now()
    let shownP = reduce ? 1 : 0
    const arr = posAttr.array

    let raf
    let last = performance.now()
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      if (!reduce) shownP = EASE(Math.min((now - t0) / INTRO_MS, 1))
      const e = shownP

      for (let i = 0; i < COUNT; i++) {
        const j = i * 3
        arr[j]     = scattered[j]     + (assembled[j]     - scattered[j])     * e
        arr[j + 1] = scattered[j + 1] + (assembled[j + 1] - scattered[j + 1]) * e
        arr[j + 2] = scattered[j + 2] + (assembled[j + 2] - scattered[j + 2]) * e
      }
      posAttr.needsUpdate = true

      if (!reduce) group.rotation.y += dt * 0.18
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onResize = () => {
      camera.aspect = w() / h()
      camera.updateProjectionMatrix()
      renderer.setSize(w(), h())
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      geo.dispose()
      mat.dispose()
      glowMat.dispose()
      sprite.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="kb-hero3d" aria-hidden="true" />
}
