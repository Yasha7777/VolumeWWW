import { useEffect, useRef, useState } from 'react'

// Лёгкое «проявление» блока при попадании во вьюпорт — без GSAP/зависимостей.
// IntersectionObserver один на элемент, отписывается сам. При prefers-reduced-motion
// контент показывается сразу, без движения (требование ui-ux-pro-max, severity High).
const REDUCE = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,      // мс, для стаггера соседних блоков
  y = 16,         // стартовое смещение вниз (px): 12–24 читается как fade, не slide
  once = true,    // проявлять один раз (не прятать при обратном скролле)
  className = '',
  ...rest
}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(REDUCE)   // reduced-motion → сразу видно

  useEffect(() => {
    if (REDUCE) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); if (once) io.disconnect() }
      else if (!once) setInView(false)
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [once])

  return (
    <Tag
      ref={ref}
      className={`kb-reveal ${inView ? 'is-in' : ''} ${className}`.trim()}
      style={{ transitionDelay: inView ? `${delay}ms` : '0ms', '--kb-reveal-y': `${y}px` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
