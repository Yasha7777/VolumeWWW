import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { DEMO_CLOUDS } from './demo'

const ObhodCloud = lazy(() => import('./ObhodCloud'))

/* Витрина под свёрнутой панелью: облако точек эталонной кучи (178 м³),
   снятой приложением, крутится и поворачивается к курсору, по ней бежит
   полоса сканирования. Показывает, что получится из обхода, ещё до выбора.
   Когда панель раскрыта — прячется и не рисует. */

function useCount(to, run, ms = 1300) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!run) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms)
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, run, ms])
  return v
}

export default function ObhodShowcase({ theme = 'light' }) {
  const box = useRef(null)
  const reduce = useReducedMotion()
  const [mount, setMount] = useState(false)
  const [ready, setReady] = useState(false)
  const [hidden, setHidden] = useState(false)
  const vol = useCount(178, ready && !reduce)
  const pts = useCount(361, ready && !reduce, 1500)

  // three.js и облако — после первой отрисовки страницы, в простое
  useEffect(() => {
    const go = () => setMount(true)
    if ('requestIdleCallback' in window) { const id = requestIdleCallback(go, { timeout: 900 }); return () => cancelIdleCallback(id) }
    const id = setTimeout(go, 500); return () => clearTimeout(id)
  }, [])
  // панель раскрыта → витрина спит
  useEffect(() => {
    const scope = box.current?.closest('.ks-scope')
    if (!scope) return
    const sync = () => setHidden(scope.dataset.picker === 'open')
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(scope, { attributes: true, attributeFilter: ['data-picker'] })
    return () => mo.disconnect()
  }, [])

  const cloud = DEMO_CLOUDS.o1
  return (
    <div ref={box} className={'ks-show' + (ready ? ' is-ready' : '') + (hidden ? ' is-hidden' : '')} aria-label="Пример результата: облако точек кучи и её объём">
      <div className="ks-show__gl">
        {mount && (
          <Suspense fallback={null}>
            <ObhodCloud src={cloud.src} theme={theme} variant="hero" paused={hidden} onReady={() => setReady(true)} />
          </Suspense>
        )}
      </div>

      <svg className="ks-show__lines" viewBox="0 0 1000 470" aria-hidden>
        <path d="M232 132 H312 L372 214" /><circle cx="372" cy="214" r="3.2" />
        <path d="M768 150 H690 L636 220" /><circle cx="636" cy="220" r="3.2" />
        <path d="M772 330 H700 L660 300" /><circle cx="660" cy="300" r="3.2" />
      </svg>

      <div className="ks-show__card ks-show__card--vol">
        <span className="ks-show__label">Объём кучи</span>
        <span className="ks-show__big">{reduce ? 178 : vol}<small> м³</small></span>
        <span className="ks-show__row">Эталонная куча отсева</span>
        <span className="ks-show__row">≈ 258 т при 1,45 т/м³</span>
      </div>
      <div className="ks-show__card ks-show__card--pts">
        <span className="ks-show__label">Облако точек</span>
        <span className="ks-show__mid">{reduce ? 361 : pts} тыс.</span>
        <span className="ks-show__row">плотная реконструкция по фото обхода</span>
      </div>
      <div className="ks-show__card ks-show__card--acc">
        <span className="ks-show__label">Точность</span>
        <span className="ks-show__mid">±1,5 %</span>
        <span className="ks-show__row">по объёму · фото + ARKit</span>
      </div>
      <p className="ks-show__cap"><span className="ks-show__dot" />Пример результата · эталонная куча · потяните, чтобы повернуть</p>
    </div>
  )
}
