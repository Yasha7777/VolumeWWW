import { useEffect } from 'react'
import Lenis from 'lenis'

// Плавный «инерционный» скролл — от него скролл-анимации (полоса прогресса,
// сборка облака, облёт рельефа) ощущаются дорого и цельно. Отключается при
// prefers-reduced-motion, чтобы не мешать тем, кто просил меньше движения.
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      // МЯГКО (по просьбе): более длинная инерция — переходы между секциями и
      // цветовые растяжки ощущаются «дорого» и слитно. lerp понижен 0.28→0.1
      // (каждый кадр догоняем цель мягче → плавный дошёл лист), колесо 1.0.
      // Не опускай ниже ~0.08 — начинает «плавать» и терять контроль.
      lerp: 0.1,
      wheelMultiplier: 1.0,
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
