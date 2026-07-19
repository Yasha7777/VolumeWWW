import { useEffect } from 'react'
import Lenis from 'lenis'

// Плавный «инерционный» скролл — от него скролл-анимации (полоса прогресса,
// сборка облака, облёт рельефа) ощущаются дорого и цельно. Отключается при
// prefers-reduced-motion, чтобы не мешать тем, кто просил меньше движения.
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      // резче: короче инерция и более «прямой» easing, чтобы скролл-скраб героя
      // ощущался чётким, а не «плавающим»
      duration: 0.6,
      lerp: 0.12,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      // на тач оставляем нативный скролл — он и так плавный, а перехват мешает
      syncTouch: false,
    })

    let raf
    const loop = (t) => { lenis.raf(t); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); lenis.destroy() }
  }, [])

  return null
}
