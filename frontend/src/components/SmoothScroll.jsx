import { useEffect } from 'react'
import Lenis from 'lenis'

// Плавный «инерционный» скролл — от него скролл-анимации (полоса прогресса,
// сборка облака, облёт рельефа) ощущаются дорого и цельно. Отключается при
// prefers-reduced-motion, чтобы не мешать тем, кто просил меньше движения.
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      // РЕЗКО и ЧЁТКО: почти нативная реакция колеса, минимум инерции. Раньше
      // (duration:0.5 / lerp:0.09) скролл «плавал» — на сайте было неудобно
      // находиться. Высокий lerp = каждый кадр почти догоняем цель → лист чёткий,
      // но колесо остаётся унифицированным (скролл-скраб героя не дёргается).
      lerp: 0.28,
      wheelMultiplier: 1.05,
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
